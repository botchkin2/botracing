// The distance range the chart y scales fit over while a window is shown:
// the whole sections the window touches, not the window itself. The window
// slides every frame; the union of whole sections only changes when one of
// its edges crosses a section boundary, so the y range never moves
// mid-corner (pit-wall thread 26 #381). Like a MoTeC/ATLAS scale per
// segment rather than per sample.
//
// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.

/**
 * `boundariesM` are the section entries in metres, any order. The lap is cut
 * at each boundary; the stretch from 0 to the first boundary is its own
 * piece. Returns [fromM, toM] covering every piece the window overlaps.
 * With no boundaries, the window itself (clamped to the lap).
 */
export function sectionFitRange(
  boundariesM: number[],
  lengthM: number,
  windowM: [number, number],
): [number, number] {
  const a = Math.max(0, Math.min(lengthM, windowM[0]));
  const b = Math.max(0, Math.min(lengthM, windowM[1]));
  const cuts = [...boundariesM]
    .filter(m => m > 0 && m < lengthM)
    .sort((x, y) => x - y);
  if (cuts.length === 0) return [a, b];
  const edges = [0, ...cuts, lengthM];
  let from = lengthM;
  let to = 0;
  for (let i = 0; i + 1 < edges.length; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    // Pieces are [lo, hi); the last one also holds the line itself.
    const last = i + 2 === edges.length;
    if ((a < hi || (last && a <= hi)) && b >= lo) {
      from = Math.min(from, lo);
      to = Math.max(to, hi);
    }
  }
  return from <= to ? [from, to] : [a, b];
}
