// Makes what a plan needs from the recordings on the curator's own machine
// (pit wall thread 2 #204 to #210): the map and boundaries a chosen session
// would give a track, or the boundaries refolded from several. Reads local
// recordings and writes nothing but scratch archives in `workDir`.
//
// The session ids are the uploader's (sessionFiles.mjs), so a session named on
// the command line is the one the uploader has under that id.
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {analyzeSession, loadRecording} from '../sessions/analyze.mjs';
import {groupFiles, scanFolder} from '../sessions/sessionFiles.mjs';
import {unpackState} from '../sessions/layoutBoundaries.mjs';

export class LoaderError extends Error {}

/** The sessions in a telemetry folder, grouped as the uploader groups them. */
export function findSessions({adapter, folder, ownerId, ownerIds, log}) {
  const owners = ownerIds ?? (ownerId ? [ownerId] : []);
  if (owners.length === 0)
    throw new LoaderError(
      'an owner is required: --owner or --owners. There is no default.',
    );
  const files = scanFolder({
    folder,
    adapter,
    state: {files: {}},
    log,
  });
  return owners.flatMap(owner => groupFiles(files, owner));
}

/** One session by id (a prefix of at least 6 characters is enough). */
export function pickSession(sessions, wanted) {
  if (String(wanted).length < 6)
    throw new LoaderError(`session id "${wanted}" is too short (6 characters)`);
  const hits = sessions.filter(s => s.id.startsWith(wanted));
  if (hits.length === 0)
    throw new LoaderError(`no session starting with ${wanted} in this folder`);
  if (hits.length > 1)
    throw new LoaderError(
      `${wanted} matches ${hits.length} sessions: ${hits
        .map(s => s.id)
        .join(', ')}`,
    );
  return hits[0];
}

/** What a session is, for choosing one: its id, track, car, time, files. */
export function describeSession(s) {
  const first = s.files[0].info;
  return {
    id: s.id,
    sim: first.sim,
    track: first.track,
    layout: first.layout,
    car: first.car,
    sessionType: first.sessionType,
    at: first.recordedAt,
    recordings: s.files.length,
  };
}

// `load` and `analyze` are the real ones; the tests pass stand-ins.
const real = {load: loadRecording, analyze: analyzeSession};

function loadRecs({adapter, session, workDir, load}) {
  const dir = resolve(workDir, session.id);
  mkdirSync(dir, {recursive: true});
  return session.files.map(f => {
    const samples = resolve(dir, `${f.id}.samples.parquet`);
    const events = resolve(dir, `${f.id}.events.parquet`);
    adapter.writeArchive(f.path, f.info, samples, events);
    return load(f.info, samples, events);
  });
}

const hasGps = recs => recs.every(r => r.s.lat_deg && r.s.lon_deg);

/**
 * The map and boundaries this one session would give its track, made as a
 * first session on that track would make them (no stored map, nothing
 * folded in before). Returns the `built` a plan takes:
 * {map, boundaries (the state), lapsUsed, gps, sessionId, sim, track}.
 */
export function buildFromSession({adapter, session, workDir, deps = real}) {
  const recs = loadRecs({adapter, session, workDir, load: deps.load});
  const first = session.files[0].info;
  const a = deps.analyze(recs, {
    sessionId: session.id,
    sessionType: first.sessionType,
  });
  return {
    // A map of too few laps is still returned: the plan refuses it with the
    // lap count, which says more than "no map".
    map: a.trackMap ?? null,
    boundaries: a.trackMapSource === 'new' ? a.boundaries?.state ?? null : null,
    lapsUsed: a.trackMapLaps ?? 0,
    gps: hasGps(recs),
    sessionId: session.id,
    sim: first.sim,
    track: {name: first.track, variant: first.layout},
  };
}

/**
 * The live boundaries refolded from chosen sessions, onto the live map:
 * each session's laps are folded in turn, as the uploader's fold pass does.
 * `current` is {track, boundaries (the stored doc)}. A session the live map
 * does not fit is refused, not folded.
 */
export function buildRefold({
  adapter,
  sessions,
  current,
  workDir,
  deps = real,
}) {
  const map = current.track;
  if (!map?.corners?.length)
    throw new LoaderError('this track has no curated map to refold onto');
  let state = unpackState(current.boundaries);
  let lapsUsed = 0;
  let gps = true;
  for (const session of sessions) {
    const recs = loadRecs({adapter, session, workDir, load: deps.load});
    gps = gps && hasGps(recs);
    const a = deps.analyze(recs, {
      trackMap: map,
      boundaries: state,
      sessionId: session.id,
      sessionType: session.files[0].info.sessionType,
    });
    if (a.trackMapSource !== 'stored' || !a.boundaries)
      throw new LoaderError(
        `session ${session.id} does not fit the live map of this track (lap length or corners differ); it cannot be folded`,
      );
    state = a.boundaries.state;
    lapsUsed += a.trackMapLaps ?? 0;
  }
  const first = sessions[0].files[0].info;
  return {
    map,
    boundaries: state,
    lapsUsed,
    gps,
    sessionId: sessions.map(s => s.id).join(','),
    sim: first.sim,
    track: {name: first.track, variant: first.layout},
  };
}
