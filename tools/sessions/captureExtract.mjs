// What a session's live capture gives its analysis, kept in the store next to
// the archive so analysis on open can use it after the PC prunes the capture
// (14 days; pit-wall thread 1 #4611): the car's damage series (pitVisit.mjs
// tells a repair from it) and the LMU race length (raceLength.mjs). A few KB.
//
//   gs://BUCKET/inputs/{ownerId}/{sessionId}/capture.json.gz
//   {v: 1, damage: {et, dent, detached} | null, raceLength: {minutes} | null}

export const CAPTURE_EXTRACT_VERSION = 1;

export const captureExtractPath = (ownerId, sessionId) =>
  `inputs/${ownerId}/${sessionId}/capture.json.gz`;

/** The extract, or null when the capture gave neither. */
export function captureExtract({damage, raceLength}) {
  if (!damage && !raceLength) return null;
  return {
    v: CAPTURE_EXTRACT_VERSION,
    damage: damage ?? null,
    raceLength: raceLength ?? null,
  };
}

/** A stored extract read back (the file's text), or null when unreadable. */
export function readCaptureExtract(text) {
  try {
    const x = JSON.parse(text);
    if (x?.v !== CAPTURE_EXTRACT_VERSION) return null;
    return {damage: x.damage ?? null, raceLength: x.raceLength ?? null};
  } catch {
    return null;
  }
}
