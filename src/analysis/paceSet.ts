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
