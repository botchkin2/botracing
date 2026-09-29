// Which way a corner turns, from the reference line in map metres (x east,
// y north). Signed curvature is the heading change over ±15 m, so a single
// kink in the 5 m grid does not flip it. A corner whose entry→exit window
// holds a clear left lobe and a clear right lobe is an S-bend, labelled in
// driving order ("L-R"); the net heading change of a chicane is near zero,
// so the sign of the whole corner would be noise (pit-wall thread 20 #522).
//
// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.

export type CornerTurn = 'L' | 'R' | 'L-R' | 'R-L';

export interface ShapeCorner {
  n: number;
  entryM: number;
  apexM: number;
  exitM: number;
}

export interface ShapeLine {
  stepM: number;
  x: number[];
  y: number[];
}

const HALF_WINDOW_M = 15;
// A lobe must turn at least this much over 30 m to count: about 8.6°, well
// above the heading noise on a straight and below any real corner.
const LOBE_MIN_RAD = 0.15;

function wrap(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// Heading of the segment starting at grid index i, wrapping around the lap.
function heading(line: ShapeLine, i: number): number {
  const n = line.x.length;
  const a = ((i % n) + n) % n;
  const b = (a + 1) % n;
  return Math.atan2(line.y[b] - line.y[a], line.x[b] - line.x[a]);
}

/** Heading change over ±15 m around a distance; positive turns left. */
export function turnAt(line: ShapeLine, m: number): number {
  const i = Math.round(m / line.stepM);
  const k = Math.max(1, Math.round(HALF_WINDOW_M / line.stepM));
  return wrap(heading(line, i + k) - heading(line, i - k));
}

export function cornerTurn(line: ShapeLine, c: ShapeCorner): CornerTurn {
  let left = 0;
  let leftAtM = 0;
  let right = 0;
  let rightAtM = 0;
  for (let m = c.entryM; m <= c.exitM; m += line.stepM) {
    const t = turnAt(line, m);
    if (t > left) {
      left = t;
      leftAtM = m;
    }
    if (-t > right) {
      right = -t;
      rightAtM = m;
    }
  }
  if (left >= LOBE_MIN_RAD && right >= LOBE_MIN_RAD) {
    return leftAtM < rightAtM ? 'L-R' : 'R-L';
  }
  return turnAt(line, c.apexM) >= 0 ? 'L' : 'R';
}
