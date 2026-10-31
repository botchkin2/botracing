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
import {readResultsInput, resultsInputPath} from './resultsInput.mjs';
import {analyzeFromArchive} from './analyzeFromArchive.mjs';
import {analysisVersion, blockVersions, trackMapVersion} from './analyze.mjs';
import {catalogStamp} from './catalogStamp.mjs';
import {isStale} from './versionKey.mjs';
import {unpackState} from './layoutBoundaries.mjs';
import {createStore} from './store.mjs';
import {mapLimit} from './mapLimit.mjs';

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

// Same segment rule as the upload endpoint (uploadCore.ts SAFE_SEGMENT).
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}$/;

/**
 * Where a recording's archive file is: always `archive/{owner}/{rest}`, the
 * folder every upload writes under (uploadCore.ts), whatever the doc says. A
 * doc's path is the client's text and is never followed as written: one that
 * names another owner's folder, or the legacy unscoped `archive/lmu/`, resolves
 * to a file under the owner's folder or to nothing (pit-wall ticket 89; all
 * 1,444 client-spelled archive paths of his recordings have their file under
 * his folder). Null for a path that is not under `archive/` or has an unsafe
 * segment.
 */
export function archivePath(path, owner) {
  if (typeof path !== 'string' || !path.startsWith('archive/')) return null;
  let segments = path.slice('archive/'.length).split('/');
  if (segments[0] === owner) segments = segments.slice(1);
  if (segments.length < 2 || !segments.every(part => SAFE_SEGMENT.test(part)))
    return null;
  return `archive/${owner}/${segments.join('/')}`;
}

async function download(backend, path, owner, to) {
  const dest = archivePath(path, owner);
  const bytes = dest ? await backend.getFile(dest) : null;
  if (!bytes) throw new AnalyzeError(409, `archive missing: ${path}`);
  writeFileSync(to, bytes);
}

/**
 * Analyse the stored session `sessionId` of `owner` again and write it back.
 * `workDir` is an empty folder for the downloaded archive. `analyze` is the
 * engine; tests pass their own. `beforeWrite` runs right before the session is
 * written and throws to stop it (the cloud's lease fence, analyzeCore.ts).
 */
export async function analyzeStored({
  backend,
  sessionId,
  owner,
  workDir,
  log = () => {},
  analyze = analyzeFromArchive,
  beforeWrite = async () => {},
}) {
  // Where an open's seconds go, in the function's log (pit-wall thread 1).
  const t0 = performance.now();
  const at = () => `${((performance.now() - t0) / 1000).toFixed(1)} s`;
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
    // Another owner's recording reads as absent, like another owner's session:
    // a session doc can name any id, so the recording's own owner decides.
    if (!doc?.archive || doc.ownerId !== owner)
      throw new AnalyzeError(409, `recording ${id} has no archive`);
    // A live recording is stored in parts, one per lap, half-open at the
    // line (pit-wall thread 66): read back as one file through a glob, which
    // gives the same docs as the whole file.
    const parts = doc.archive.parts ?? null;
    // Side by side: one at a time, a 31-lap race spent 5.3 s here (pit wall
    // thread 69 #5718).
    if (parts)
      await mapLimit(parts, 8, async (part, i) => {
        const n = String(i).padStart(3, '0');
        await Promise.all([
          download(
            backend,
            part.samples,
            owner,
            join(workDir, `${id}.samples.${n}.parquet`),
          ),
          download(
            backend,
            part.events,
            owner,
            join(workDir, `${id}.events.${n}.parquet`),
          ),
        ]);
      });
    const samplesPath = join(
      workDir,
      `${id}.samples${parts ? '.*' : ''}.parquet`,
    );
    const eventsPath = join(
      workDir,
      `${id}.events${parts ? '.*' : ''}.parquet`,
    );
    if (!parts) {
      await download(backend, doc.archive.samples, owner, samplesPath);
      await download(backend, doc.archive.events, owner, eventsPath);
    }
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
  // The game's track-limit rulings the PC kept (resultsInput.mjs), if any.
  const storedResults = await backend.getFile(
    resultsInputPath(owner, sessionId),
  );
  const results = storedResults
    ? readResultsInput(gunzipSync(storedResults).toString('utf8'))
    : null;
  log(`${at()} archive downloaded`);
  const out = analyze({
    ownerId: owner,
    sessionId,
    recordings,
    trackMap,
    boundaries: packed ? unpackState(packed) : null,
    catalogOnly: true,
    damage: extract?.damage ?? null,
    results,
    // iRacing's comes from the .ibt's session info, kept on the recording doc;
    // LMU's from the capture extract, else store.mjs keeps the stored one.
    raceLength: !/^r/i.test(first.sessionType ?? '')
      ? null
      : first.sim === 'iracing'
      ? first.raceLength ?? null
      : extract?.raceLength ?? null,
    online: extract?.online ?? null,
    event: {series: session.series ?? null, eventId: session.eventId ?? null},
    fieldFor: () => ({field: null, reason: 'analysed from the store'}),
  });
  log(`${at()} analysed, ${out.laps.length} laps`);
  // A live session (pit-wall thread 66): say how many laps this analysis
  // read, so a lap the tray adds meanwhile is not taken as analysed (store.mjs).
  const analysedParts = recordings.reduce(
    (n, r) => n + (r.info.archive?.parts?.length ?? 0),
    0,
  );
  if (analysedParts > 0) {
    out.session.archiveParts = analysedParts;
    out.session.live = session.live ?? null;
  } else if (session.live) {
    // The healed drive: its recordings carry no live parts. The stamp read
    // here is what tells a lap that lands meanwhile from a counter that
    // drifted (store.mjs keepNewerLive, thread 103).
    out.session.live = session.live;
  }
  await beforeWrite();
  await store.upload(
    {
      ...out,
      // Already stored, unchanged: the recordings and their archive, so none
      // is written (store.mjs: recordingsAreStored).
      recordings: recordings.map(r => r.info),
      recordingsAreStored: true,
      files: [],
      // Curated: never written from here.
      track: null,
      boundaries: null,
    },
    {log},
  );
  log(`${at()} written`);
  return {laps: out.laps.length};
}
