// The lap selection, as one set of lap ids per session. The URL owns it (see
// nav/routes.ts); these rules say how a tap or a drag changes it. There is no
// cap and no reference lap here: a reference exists only when the user picks
// Ref mode, and the chosen laps are compared with their own median (Botkin's
// rule: a set of laps against its median, never a privileged lap).

/** A tap on one lap: add it when it is not ticked, remove it when it is. */
export function toggle(laps: readonly string[], lapId: string): string[] {
  return laps.includes(lapId)
    ? laps.filter(id => id !== lapId)
    : [...laps, lapId];
}

/**
 * A drag over a stint: the selection becomes that stint, in the order the
 * drag gave it, with no duplicates. An empty stint clears the selection.
 */
export function replace(stint: readonly string[]): string[] {
  return [...new Set(stint)];
}

/**
 * The laps the strip's deltas are measured against: the ticked laps when any
 * are ticked, else every comparable lap (so an empty selection still reads).
 */
export function basisLaps(
  ticked: readonly string[],
  comparable: readonly string[],
): string[] {
  return ticked.length > 0 ? [...ticked] : [...comparable];
}
