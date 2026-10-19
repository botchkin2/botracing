// The opening set's rule (decisions/lap/2026-10-12-default-selection-outliers.md):
// the laps whose pace is judged, minus the slow ones. One rule, two readers:
// the app's session screens (data/sessions/defaultLaps.ts) and the uploader,
// which stores the set's lap times on the session doc for the track
// progression (analyzeFromArchive.mjs, pit wall thread 88). Pure; Node runs it
// as is, so imports stay relative with their extension.

/** What the rule reads of a lap. */
export type PaceLap = {
  timeS: number | null;
  partial: boolean;
  pitIn: boolean;
  pitOut: boolean;
  reasons: readonly string[];
};

/**
 * A stored lap doc as the rule reads it. The app's adapter (data/sessions/
 * adapters.ts toLaps) and the uploader (analyzeFromArchive.mjs) both map
 * through this, so a dot and its session screen cannot read a lap two ways.
 */
export function paceFieldsOf(raw: Record<string, unknown>): PaceLap & {
  reasons: string[];
} {
  const t = raw.lapTime;
  return {
    timeS:
      raw.timed === false || typeof t !== 'number' || !Number.isFinite(t)
        ? null
        : t,
    partial: raw.partial === true || raw.incomplete === true,
    pitIn: raw.pitIn === true,
    pitOut: raw.pitOut === true,
    reasons: Array.isArray(raw.reasons)
      ? raw.reasons.map(r => (typeof r === 'string' ? r : ''))
      : [],
  };
}

/** The laps whose pace is judged: timed, whole, and not in or out of the pits (an in- or out-lap is a different lap). */
export function paceCandidates<L extends PaceLap>(laps: readonly L[]): L[] {
  return laps.filter(
    l => l.timeS != null && !l.partial && !l.pitIn && !l.pitOut,
  );
}

/**
 * The opening set: every candidate except the slow ones ("slow" is the stored
 * reason the uploader set with analysis/paceEvents.ts). Under two laps there
 * is no set, and this is empty.
 */
export function paceSetOf<L extends PaceLap>(laps: readonly L[]): L[] {
  const set = paceCandidates(laps).filter(l => !l.reasons.includes('slow'));
  return set.length >= 2 ? set : [];
}
