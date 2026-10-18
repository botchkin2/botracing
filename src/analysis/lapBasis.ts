// The laps a set's numbers describe, defined once: the Session rows, the grid,
// the lap strip and the Corner landing all read this, so a number and the place
// it sends the driver to are of the same laps. Pure; no imports.

/**
 * The laps the numbers describe: the ticked ones, or every comparable lap when
 * none is ticked (the lap strip's rule, src/state/lapSelection.ts), so an
 * empty selection still reads.
 */
export function basisOf<L extends {id: string; comparable: boolean}>(
  laps: readonly L[],
  ticked: ReadonlySet<string>,
): L[] {
  const picked = laps.filter(l => ticked.has(l.id));
  return picked.length > 0 ? picked : laps.filter(l => l.comparable);
}
