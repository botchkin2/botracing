// What a session's live capture gives its analysis, kept in the store next to
// the archive so analysis on open can use it after the PC prunes the capture
// (14 days; pit-wall thread 1 #4611): the car's damage series (pitVisit.mjs
// tells a repair from it), the LMU race length (raceLength.mjs) and whether the
// session was online (gameMode.mjs). A few KB.
//
//   gs://BUCKET/inputs/{ownerId}/{sessionId}/capture.json.gz
//   {v: 1, damage: {et, dent, detached} | null, raceLength: {minutes} | null, online?: boolean | null}

export const CAPTURE_EXTRACT_VERSION = 1;

export const captureExtractPath = (ownerId, sessionId) =>
  `inputs/${ownerId}/${sessionId}/capture.json.gz`;

/** The extract, or null when the capture gave neither. */
export function captureExtract({damage, raceLength, online = null}) {
  if (!damage && !raceLength && online == null) return null;
  return {
    v: CAPTURE_EXTRACT_VERSION,
    damage: damage ?? null,
    raceLength: raceLength ?? null,
    online: online ?? null,
  };
}

/** A stored extract read back (the file's text), or null when unreadable. */
export function readCaptureExtract(text) {
  try {
    const x = JSON.parse(text);
    if (x?.v !== CAPTURE_EXTRACT_VERSION) return null;
    return {
      damage: x.damage ?? null,
      raceLength: x.raceLength ?? null,
      online: typeof x.online === 'boolean' ? x.online : null,
    };
  } catch {
    return null;
  }
}
