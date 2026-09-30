// Vertical stacking for dot strips: dots stay on the line unless they
// would overlap one already drawn, then take the nearest free row
// (+1, −1, +2, …). Two dots overlap when they are closer than a dot on
// screen, or when their values are within the channel's resolution: two
// brake points 1 m apart at ±1.2 m are the same point (pit-wall thread 27
// #678), and stacking shows there are two of them.
//
// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.

export interface StackInput {
  /** Screen x, points. */
  x: number;
  value: number;
  /**
   * Placed before the others, so it takes the line and the rest stack around
   * it: the laps that are on, never buried in a column of grey dots.
   */
  priority?: boolean;
}

/** Row per dot, in input order: 0 on the line, ±1, ±2 … above and below. */
export function stackDots(
  dots: StackInput[],
  diameterPt: number,
  coincidentWithin: number,
): number[] {
  const order = dots
    .map((_, i) => i)
    .sort(
      (a, b) =>
        Number(!!dots[b].priority) - Number(!!dots[a].priority) ||
        dots[a].x - dots[b].x,
    );
  const rows = new Array<number>(dots.length).fill(0);
  const placed: {x: number; value: number; row: number}[] = [];
  for (const i of order) {
    const d = dots[i];
    const clash = (row: number) =>
      placed.some(
        p =>
          p.row === row &&
          (Math.abs(p.x - d.x) < diameterPt ||
            Math.abs(p.value - d.value) <= coincidentWithin),
      );
    let row = 0;
    for (let k = 1; clash(row); k++) row = k % 2 ? Math.ceil(k / 2) : -k / 2;
    rows[i] = row;
    placed.push({x: d.x, value: d.value, row});
  }
  return rows;
}
