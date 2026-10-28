// What the game's results file gave a session's analysis (lmuResults.mjs), kept
// in the store beside the archive so the cloud can use it without the PC (the
// same job as captureExtract.mjs; pit-wall thread 70, design #5521 point 2):
//
//   gs://BUCKET/inputs/{ownerId}/{sessionId}/results.json.gz
//   {v: 2, strikes: [{et, points, outcome, ruling}], unplaced: n, coveredFrom, coveredTo, drivers}
//
// A few hundred bytes of strikes, and the drivers: ~13 KB for 60 cars, gzipped far less.
// Absent when the PC has no results file for the session.
//
// v2 (ticket 20, thread 111) adds `drivers`: every driver's laps for the class
// pace (src/analysis/classPace.ts), [{player, cls, car, pos, overall, status,
// laps: [{t, s1, s2, s3, pit}]}]; `pos` is the class position, `overall` the
// place among all cars and `status` the game's FinishStatus, which the race
// result reads (analysis/raceResult.ts finishFromResults), t and the sectors null where the file reads `--.----`. No names,
// no numbers, no other driver's strikes. The reader takes both versions, so a
// session whose input is v1 keeps its track-limit strikes (a reader that refused
// v2 would lose them silently on the next open). The writer (lmuResults.mjs
// `driversOf`) writes 2; a stored v1 input is re-sent once by the backlog
// (resultsBacklog.mjs). It ships only after a functions deploy carrying the v2
// reader is live: #774's.

export const RESULTS_INPUT_VERSION = 2;

/** The versions the reader takes. */
const READABLE_VERSIONS = [1, 2];

export const resultsInputPath = (ownerId, sessionId) =>
  `inputs/${ownerId}/${sessionId}/results.json.gz`;

/** The input from `resultsFor`'s answer, or null when it found no file. */
export function resultsInput(found) {
  if (!found || found.absent) return null;
  return {
    v: RESULTS_INPUT_VERSION,
    strikes: found.strikes,
    unplaced: found.unplaced,
    coveredFrom: found.coveredFrom,
    coveredTo: found.coveredTo,
    drivers: found.drivers,
  };
}

const timeOrNull = v => (Number.isFinite(v) ? v : null);

/** One driver of a stored v2 input, or null when it is not the shape the writer makes. */
function readDriver(d) {
  if (typeof d?.cls !== 'string' || typeof d.car !== 'string') return null;
  if (!Array.isArray(d.laps)) return null;
  return {
    player: d.player === true,
    cls: d.cls,
    car: d.car,
    pos: timeOrNull(d.pos),
    overall: timeOrNull(d.overall),
    status: typeof d.status === 'string' ? d.status : null,
    laps: d.laps.map(l => ({
      t: timeOrNull(l?.t),
      s1: timeOrNull(l?.s1),
      s2: timeOrNull(l?.s2),
      s3: timeOrNull(l?.s3),
      pit: l?.pit === true,
    })),
  };
}

/**
 * A stored input read back (the file's text), or null when unreadable. `drivers`
 * is there for a v2 input only (a driver that is not the stored shape is left out).
 */
export function readResultsInput(text) {
  try {
    const x = JSON.parse(text);
    if (!READABLE_VERSIONS.includes(x?.v) || !Array.isArray(x.strikes))
      return null;
    const drivers =
      x.v >= 2 && Array.isArray(x.drivers)
        ? x.drivers.map(readDriver).filter(d => d !== null)
        : null;
    return {
      strikes: x.strikes,
      unplaced: Number(x.unplaced) || 0,
      // The session times the file's laps of his cover; null when it lists none.
      coveredFrom: Number.isFinite(x.coveredFrom) ? x.coveredFrom : null,
      coveredTo: Number.isFinite(x.coveredTo) ? x.coveredTo : null,
      ...(drivers ? {drivers} : {}),
    };
  } catch {
    return null;
  }
}

/**
 * The outcomes that delete the lap they land in (lmuResults.mjs
 * DELETING_RESOLUTIONS, by the names OUTCOMES gives its codes): the analysis
 * reads the stored input, which carries names, not codes.
 */
export const DELETING_OUTCOMES = new Set([
  'warning',
  'invalidCut',
  'invalidOff',
]);
