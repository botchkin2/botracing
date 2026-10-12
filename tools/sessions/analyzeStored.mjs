// Analysis on open: one stored session analysed again from what the store
// holds, with no PC (pit-wall thread 1 #4572). The inputs analyzeFromArchive
// needs come from the session's own docs and files:
//
//   recordings      the recording docs (each one's description and archive)
//   archive         the recording's samples and events parquet, downloaded
//   track map       tracks/{trackId}, boundaries trackBoundaries/{trackId}
//   event           the session doc's series and eventId, as stored
//   field           the stored field file: store.mjs keeps it and works the
//                   traffic, class laps and result out of it again
//   damage, LMU race length
//                   the capture extract the tray uploaded with the session
//                   (captureExtract.mjs); without one, store.mjs keeps the
//                   stored values (keepCapture.mjs) and the stamp says kept
//
// Track data is curated (tools/curate): this never writes a map or boundaries.
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {captureExtractPath, readCaptureExtract} from './captureExtract.mjs';
import {analyzeFromArchive} from './analyzeFromArchive.mjs';
import {analysisVersion, blockVersions, trackMapVersion} from './analyze.mjs';
import {catalogStamp} from './catalogStamp.mjs';
import {isStale} from './versionKey.mjs';
import {unpackState} from './layoutBoundaries.mjs';
import {createStore} from './store.mjs';

/**
 * Whether a stored session needs analysing again now: the rules it was made
 * under, and the curated track it was cut at against today's (the same map
 * and boundaries analyzeStored would use). `getDoc(coll, id)` reads the store.
 */
export async function staleNow(session, getDoc) {
  const trackId = session.trackId;
  let [trackMap, packed] = trackId
    ? await Promise.all([
        getDoc('tracks', trackId),
        getDoc('trackBoundaries', trackId),
      ])
    : [null, null];
  if (trackMap && trackMap.mapVersion !== trackMapVersion) trackMap = null;
  return isStale(
    session.analysis,
    analysisVersion,
    blockVersions,
    catalogStamp(trackMap, packed ? unpackState(packed) : null),
  );
}

export class AnalyzeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Where a recording's archive file may be. The doc names the path it was
 * written under; a tray upload sits under the owner's key as well
 * (uploadCore.ts), and 50 docs written before that name the old path while
 * the file is under the owner's (pit-wall thread 1 #4550).
 */
export function archiveCandidates(path, ownerKey) {
  const out = [path];
  const rest = path.replace(/^archive\//, '');
  if (rest !== path && !rest.startsWith(`${ownerKey}/`))
    out.push(`archive/${ownerKey}/${rest}`);
  return out;
}

async function download(backend, path, ownerKey, to) {
  for (const candidate of archiveCandidates(path, ownerKey)) {
    const bytes = await backend.getFile(candidate);
    if (bytes) {
      writeFileSync(to, bytes);
      return;
    }
  }
  throw new AnalyzeError(409, `archive missing: ${path}`);
}

/**
 * Analyse the stored session `sessionId` of `owner` again and write it back.
 * `workDir` is an empty folder for the downloaded archive. `analyze` is the
 * engine; tests pass their own.
 */
export async function analyzeStored({
  backend,
  sessionId,
  owner,
  workDir,
  log = () => {},
  analyze = analyzeFromArchive,
}) {
  const session = await backend.getDoc('sessions', sessionId);
  // Another owner's session reads as absent, as the API's reads do.
  if (!session || session.ownerId !== owner)
    throw new AnalyzeError(404, 'session not found');
  const ids = session.recordingIds ?? [];
  if (ids.length === 0)
    throw new AnalyzeError(409, 'session has no recordings');
  mkdirSync(workDir, {recursive: true});
  const recordings = [];
  for (const id of ids) {
    const doc = await backend.getDoc('recordings', id);
    if (!doc?.archive)
      throw new AnalyzeError(409, `recording ${id} has no archive`);
    const samplesPath = join(workDir, `${id}.samples.parquet`);
    const eventsPath = join(workDir, `${id}.events.parquet`);
    await download(backend, doc.archive.samples, owner, samplesPath);
    await download(backend, doc.archive.events, owner, eventsPath);
    recordings.push({id, info: doc, samplesPath, eventsPath});
  }
  const store = createStore(backend);
  const trackId = session.trackId;
  let trackMap = trackId ? await store.getTrack(trackId) : null;
  // A map of an older version is no map (sync.mjs trackMapFor).
  if (trackMap && trackMap.mapVersion !== trackMapVersion) trackMap = null;
  const packed = trackId ? await store.getBoundaries(trackId) : null;
  const first = recordings[0].info;
  // What the PC's capture gave, when the tray kept it (captureExtract.mjs):
  // with it a repair and the LMU race length are worked out again, not kept.
  const stored = await backend.getFile(captureExtractPath(owner, sessionId));
  const extract = stored
    ? readCaptureExtract(gunzipSync(stored).toString('utf8'))
    : null;
  const out = analyze({
    ownerId: owner,
    sessionId,
    recordings,
    trackMap,
    boundaries: packed ? unpackState(packed) : null,
    catalogOnly: true,
    damage: extract?.damage ?? null,
    // iRacing's comes from the .ibt's session info, kept on the recording doc;
    // LMU's from the capture extract, else store.mjs keeps the stored one.
    raceLength: !/^r/i.test(first.sessionType ?? '')
      ? null
      : first.sim === 'iracing'
      ? first.raceLength ?? null
      : extract?.raceLength ?? null,
    event: {series: session.series ?? null, eventId: session.eventId ?? null},
    fieldFor: () => ({field: null, reason: 'analysed from the store'}),
  });
  await store.upload(
    {
      ...out,
      // Already stored, unchanged: the recordings and their archive.
      recordings: recordings.map(r => r.info),
      files: [],
      // Curated: never written from here.
      track: null,
      boundaries: null,
    },
    {log},
  );
  return {laps: out.laps.length};
}
