// What the game's results file gave a session's analysis (lmuResults.mjs), kept
// in the store beside the archive so the cloud can use it without the PC (the
// same job as captureExtract.mjs; pit-wall thread 70, design #5521 point 2):
//
//   gs://BUCKET/inputs/{ownerId}/{sessionId}/results.json.gz
//   {v: 1, strikes: [{et, points, outcome, ruling}], unplaced: n, coveredFrom, coveredTo}
//
// A few hundred bytes. Absent when the PC has no results file for the session.

export const RESULTS_INPUT_VERSION = 1;

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
  };
}

/** A stored input read back (the file's text), or null when unreadable. */
export function readResultsInput(text) {
  try {
    const x = JSON.parse(text);
    if (x?.v !== RESULTS_INPUT_VERSION || !Array.isArray(x.strikes))
      return null;
    return {
      strikes: x.strikes,
      unplaced: Number(x.unplaced) || 0,
      // The session times the file's laps of his cover; null when it lists none.
      coveredFrom: Number.isFinite(x.coveredFrom) ? x.coveredFrom : null,
      coveredTo: Number.isFinite(x.coveredTo) ? x.coveredTo : null,
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
