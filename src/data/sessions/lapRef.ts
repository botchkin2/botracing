// A lap named in the URL's `?laps=`. Lap ids are recordingId-NNN and do not
// say which session a lap is from, so a lap from another session (a reference
// from an earlier race, pit-wall thread 44 E3) is written `sessionId~lapId`.
// A lap of the URL's own session stays a bare lap id.

const SEPARATOR = '~';

/** The id a lap of another session goes by in the selection. */
export function foreignLapId(sessionId: string, lapId: string): string {
  return `${sessionId}${SEPARATOR}${lapId}`;
}

export type LapRef = {sessionId: string | null; lapId: string};

/** Splits a selection id: `sessionId` is null for a lap of the URL's own session. */
export function parseLapRef(id: string): LapRef {
  const at = id.indexOf(SEPARATOR);
  if (at <= 0 || at === id.length - 1) return {sessionId: null, lapId: id};
  return {sessionId: id.slice(0, at), lapId: id.slice(at + 1)};
}
