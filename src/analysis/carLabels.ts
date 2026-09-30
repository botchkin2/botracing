// Car labels on the race map (round 3 R1e): one label per car, placed next to
// its dot, best-ranked first. A label that would cover a dot, an already
// placed label or an overlay control is dropped, never shrunk or stacked.
//
// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.

export interface Box {
  /** Top left, in the map's own points. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LabelCar {
  key: string;
  /** The dot's centre and radius, map points. */
  x: number;
  y: number;
  radius: number;
  /** The label's size, map points. */
  width: number;
  height: number;
  /** Lower places first: focused, you, the cars around you, class leaders, the rest. */
  rank: number;
}

// Gap between the dot's edge and its label.
const GAP = 3;
// Tried in order: right, left, above, below, then the diagonals.
const SIDES: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, -1],
  [0, 1],
  [1, -1],
  [-1, -1],
  [1, 1],
  [-1, 1],
];

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/**
 * Top-left corners of the labels that fit, by car key. `avoid` boxes are the
 * overlay controls, the radar inset and the attribution; `bounds` is the map.
 */
export function placeCarLabels(
  cars: LabelCar[],
  avoid: Box[],
  bounds: {width: number; height: number},
): Map<string, {x: number; y: number}> {
  const dots: Box[] = cars.map(c => ({
    x: c.x - c.radius,
    y: c.y - c.radius,
    width: 2 * c.radius,
    height: 2 * c.radius,
  }));
  const taken: Box[] = [...avoid];
  const out = new Map<string, {x: number; y: number}>();
  const order = cars
    .map((c, i) => i)
    .sort((a, b) => cars[a].rank - cars[b].rank || a - b);
  for (const i of order) {
    const c = cars[i];
    for (const [sx, sy] of SIDES) {
      const cx = c.x + sx * (c.radius + GAP + c.width / 2);
      const cy = c.y + sy * (c.radius + GAP + c.height / 2);
      // Diagonals sit at the corner: centre on the offset in both axes.
      const box: Box = {
        x: cx - c.width / 2,
        y: cy - c.height / 2,
        width: c.width,
        height: c.height,
      };
      if (
        box.x < 0 ||
        box.y < 0 ||
        box.x + box.width > bounds.width ||
        box.y + box.height > bounds.height
      )
        continue;
      if (taken.some(t => overlaps(box, t))) continue;
      // Other cars' dots (not this car's own) are in the way too.
      if (dots.some((d, j) => j !== i && overlaps(box, d))) continue;
      taken.push(box);
      out.set(c.key, {x: box.x, y: box.y});
      break;
    }
  }
  return out;
}
