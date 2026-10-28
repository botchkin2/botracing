// The car bodies the 3D draws: one hull per class, and from it one body per known model (modelShapes), picked from the
// car's `vehicle`. STYLISED, NOT TO SCALE: a model's numbers exaggerate the cue it is read by, inside the class footprint's
// width. An unknown model keeps the class hull.
// Plain TypeScript, no three.js: the stations are numbers and carMeshes lofts them.

import {PAINTS, stepOfName} from './carPaint';
import {modelOf} from './modelShapes';
import {applyParams} from './modelParams';

/** Class footprints (length x width, metres): the class nominal, the data carries no model dimensions. */
export const SIZE: Record<string, [number, number]> = {
  Hyper: [5.0, 2.0],
  LMP2: [4.75, 1.9],
  // The LMP3 envelope: Ligier JS P325 4,605 x 1,900 on 2,860 and ADESS AD25 4,650 x 1,890 on 2,925 (Wikipedia, ADESS's sheet),
  // so about 4.63 x 1.9 m; the width is the LMP2's, only the length is shorter (pit-wall thread 124 #8162).
  LMP3: [4.63, 1.9],
  GT3: [4.65, 1.95],
};

/**
 * A body as stations along the car (x forward from the centre, metres): at each, the half-width at the sill and at the
 * top, the shoulder height and the top height. Lofted between stations, flat shaded, it is a low-poly hull that narrows
 * to the nose and carries a cabin. Proportions follow the class shapes of prototype v2 (thread 83), simplified.
 */
export type Station = [
  x: number,
  halfW: number,
  shoulderY: number,
  topHalfW: number,
  topY: number,
];

/** How the rear wing is carried: on two stalks, two wide-spaced stalks, a swan-neck pair, one central pylon, low on the tail, or not at all. */
export type WingKind = 'none' | 'low' | 'stalks' | 'wide' | 'pylons' | 'pylon';

/** The wing's pylons as fractions of its half-span, left to right. */
export const WING_PYLONS: Record<WingKind, number[]> = {
  none: [],
  low: [-0.42, 0.42],
  stalks: [-0.42, 0.42],
  wide: [-0.47, 0.47],
  pylons: [-0.25, 0.25],
  pylon: [0],
};

/** A wing end plate: `h` rises above the wing, `sweep` cuts the top rear corner back (0 is square). */
export interface EndPlate {
  h: number;
  sweep: number;
}

/** A light unit on the tail face, a polyline of (lateral z, height y) points: the Alpine's chevron, the 9X8's claws. */
export type TailLight = [z: number, y: number][];

/** The light lines stand this far behind the tail face, so they never sink into it. */
export const LIGHT_OFFSET_M = 0.012;

/** A raised pod on the hull, mirrored left and right: centre x, length, distance from the centre line, width, crest height above the hull's top line. */
export interface Bulge {
  x: number;
  len: number;
  z: number;
  w: number;
  h: number;
}

export interface ClassShape {
  hull: Station[];
  /** The glasshouse, drawn dark over the hull. */
  cabin: Station[];
  /** Rear wing: centre x, top y, chord, span. */
  wing: [number, number, number, number];
  /** How the wing is carried; stalks when absent. */
  wingKind?: WingKind;
  /** Raised pods on the hull (fender crests, haunches); none when absent. */
  bulges?: Bulge[];
  /** The wing's end plates: their height above the wing and how far the top rear corner is swept back, metres; none when absent. */
  endPlate?: EndPlate;
  /** Light lines on the tail face, drawn as extra segments of the body edges (no extra draw); none when absent. */
  tailLights?: TailLight[];
  /** Prototype shark fin: from x, length, height; null on a GT. */
  fin: [number, number, number] | null;
  /** Wheels (four dark discs, merged into the body): front axle x, rear axle x, radius, width; the outer face stands a few cm outside the hull's widest half-width (carMeshes). */
  wheels: [front: number, rear: number, radius: number, width: number];
}

export const SILL_Y = 0.1;

export const SHAPES: Record<string, ClassShape> = {
  GT3: {
    hull: [
      [2.33, 0.62, 0.34, 0.42, 0.44],
      [1.85, 0.92, 0.52, 0.7, 0.66],
      [1.0, 0.97, 0.7, 0.72, 0.84],
      [-0.9, 0.98, 0.78, 0.7, 0.9],
      [-1.75, 0.99, 0.82, 0.78, 0.94],
      [-2.1, 0.97, 0.8, 0.74, 0.9],
      [-2.34, 0.86, 0.6, 0.6, 0.7],
    ],
    cabin: [
      [0.8, 0.68, 0.84, 0.64, 0.86],
      [0.1, 0.7, 0.86, 0.56, 1.2],
      [-0.75, 0.68, 0.88, 0.52, 1.16],
      [-1.2, 0.66, 0.9, 0.6, 0.94],
    ],
    wing: [-2.15, 1.22, 0.42, 1.85],
    fin: null,
    wheels: [1.42, -1.42, 0.36, 0.26],
  },
  Hyper: {
    hull: [
      [2.5, 0.7, 0.24, 0.5, 0.32],
      [1.9, 0.98, 0.42, 0.76, 0.56],
      [1.0, 0.99, 0.62, 0.66, 0.7],
      [-0.6, 0.94, 0.66, 0.6, 0.76],
      [-1.8, 1.0, 0.76, 0.8, 0.86],
      [-2.25, 0.98, 0.74, 0.76, 0.82],
      [-2.5, 0.86, 0.52, 0.6, 0.64],
    ],
    cabin: [
      [0.95, 0.56, 0.7, 0.5, 0.72],
      [0.3, 0.6, 0.74, 0.46, 1.06],
      [-0.45, 0.56, 0.76, 0.42, 1.04],
      [-0.95, 0.5, 0.76, 0.42, 0.8],
    ],
    wing: [-2.32, 1.02, 0.4, 1.9],
    fin: [-1.95, 1.4, 0.38],
    wheels: [1.55, -1.5, 0.37, 0.32],
  },
  LMP2: {
    hull: [
      [2.36, 0.66, 0.24, 0.48, 0.32],
      [1.8, 0.93, 0.4, 0.72, 0.52],
      [0.9, 0.94, 0.58, 0.62, 0.66],
      [-0.6, 0.88, 0.62, 0.56, 0.72],
      [-1.7, 0.95, 0.72, 0.76, 0.82],
      [-2.12, 0.93, 0.7, 0.72, 0.78],
      [-2.36, 0.82, 0.5, 0.58, 0.62],
    ],
    cabin: [
      [0.82, 0.52, 0.66, 0.46, 0.68],
      [0.3, 0.56, 0.7, 0.42, 1.0],
      [-0.4, 0.52, 0.72, 0.4, 0.98],
      [-0.85, 0.48, 0.72, 0.4, 0.76],
    ],
    wing: [-2.2, 1.12, 0.4, 1.8],
    fin: [-1.8, 1.5, 0.46],
    wheels: [1.45, -1.4, 0.35, 0.3],
  },
};

// The LMP3 hull is the LMP2 language at the LMP3 envelope: shorter, on a shorter wheelbase (2.89 m, between the two published).
SHAPES.LMP3 = applyParams(SHAPES.LMP2, {lengthM: 4.63, wheelbaseM: 2.89});

/**
 * The class whose hull draws a car of `carClass`: its own when it has one, else the nearest by its own name (an LMP2_ELMS
 * is a prototype, a Hyper-anything an Hypercar), and only a class with nothing to read from falls back to GT3 (pit-wall
 * thread 124, scout #8133: a prototype is never drawn as a coupé).
 */
export function shapeClassOf(carClass: string): string {
  if (SHAPES[carClass]) return carClass;
  const c = carClass.toLowerCase();
  if (/lmp3/.test(c)) return 'LMP3';
  if (/lmp|prototype/.test(c)) return 'LMP2';
  if (/hyper|lmh|lmdh|gtp/.test(c)) return 'Hyper';
  return 'GT3';
}

/**
 * The tail's light lines as flat segments [x1, y1, z1, x2, y2, z2] in the car's frame, on a plane just behind its last hull
 * station. Explicit segments, not creases, so EdgesGeometry would never find them (pit-wall thread 124, steward #8140).
 */
export function lightSegments(c: ClassShape): number[][] {
  const x = c.hull[c.hull.length - 1][0] - LIGHT_OFFSET_M;
  const out: number[][] = [];
  for (const line of c.tailLights ?? [])
    for (let i = 0; i + 1 < line.length; i++)
      out.push([x, line[i][1], line[i][0], x, line[i + 1][1], line[i + 1][0]]);
  return out;
}

/** The hull's top height at x, interpolated between stations (the nose tip's and the tail's outside their range). */
export function hullTopAt(hull: Station[], x: number): number {
  for (let i = 0; i < hull.length - 1; i++) {
    const [x0, , , , y0] = hull[i];
    const [x1, , , , y1] = hull[i + 1];
    if (x <= x0 && x >= x1)
      return x0 === x1 ? y0 : y0 + ((y1 - y0) * (x0 - x)) / (x0 - x1);
  }
  return x > hull[0][0] ? hull[0][4] : hull[hull.length - 1][4];
}

/**
 * The shape to draw for a car: its model's (modelShapes: the class hull and the model's numbers), else the class hull.
 * `key` names it for the kit's cache, `footprint` is the ground box from the shape's own length, and `paint` is the
 * model's colour index in its class (carPaint; a model nothing places gets a stable one from its name).
 */
export function shapeFor(
  vehicle: string | null,
  carClass: string,
): {
  key: string;
  shape: ClassShape;
  footprint: [number, number];
  paint: number;
} {
  const cls = shapeClassOf(carClass);
  const [classLength, width] = SIZE[cls];
  const model = modelOf(vehicle, cls);
  if (model) {
    const {entry, index} = model;
    const shaped = applyParams(SHAPES[cls], entry.params);
    return {
      key: `${cls}:${entry.key}`,
      shape: entry.tailLights
        ? {...shaped, tailLights: entry.tailLights}
        : shaped,
      footprint: [entry.params.lengthM ?? classLength, width],
      paint: index % PAINTS,
    };
  }
  return {
    key: cls,
    shape: SHAPES[cls],
    footprint: SIZE[cls],
    paint: stepOfName(vehicle),
  };
}
