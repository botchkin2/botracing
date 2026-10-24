// The car bodies the 3D draws: one hull per class, and from it a few stylised body families told apart by what shows
// at a glance (where the cabin sits, how long the nose is, the wing), picked from the car's `vehicle`.
// STYLISED, NOT TO SCALE: no per-model measurement is claimed. The data carries no model dimensions, and the figures
// that are published (the LMDh/LMH regulation caps, a few race-car sheets) differ by 2-4 %, which is invisible, so a
// family only moves the cabin, shortens the nose or scales the wing, always inside the class footprint and never
// beyond it (pit-wall thread 94 #6866-#6868). An unknown model keeps the class hull.
// Plain TypeScript, no three.js: the stations are numbers and carMeshes lofts them.

/** Class footprints (length x width, metres): the class nominal, the data carries no model dimensions. */
export const SIZE: Record<string, [number, number]> = {Hyper: [5.0, 2.0], LMP2: [4.75, 1.9], GT3: [4.65, 1.95]};

/**
 * A body as stations along the car (x forward from the centre, metres): at each, the half-width at the sill and at the
 * top, the shoulder height and the top height. Lofted between stations, flat shaded, it is a low-poly hull that narrows
 * to the nose and carries a cabin. Proportions follow the class shapes of prototype v2 (thread 83), simplified.
 */
export type Station = [x: number, halfW: number, shoulderY: number, topHalfW: number, topY: number];

export interface ClassShape {
  hull: Station[];
  /** The glasshouse, drawn dark over the hull. */
  cabin: Station[];
  /** Rear wing: centre x, top y, chord, span. */
  wing: [number, number, number, number];
  /** Prototype shark fin: from x, length, height; null on a GT. */
  fin: [number, number, number] | null;
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
  },
};

export type Family = 'lmh' | 'lmdh' | 'gt3-front' | 'gt3-mid' | 'gt3-rear';

/** What a family changes on its class hull (all small, all inside the class footprint). */
interface Variant {
  /** The glasshouse moves along the car: + forward, metres. */
  cabinShiftX: number;
  /** The front stations pull back by this share of their distance from the centre (0 keeps the class nose). */
  noseShorten: number;
  /** The rear wing's height above the tail, scaled. */
  wingScale: number;
  /** The cabin's roof height above its shoulder, scaled: a rear-engined car's rounder greenhouse. */
  roofScale: number;
}

const VARIANTS: Record<Family, Variant> = {
  // front engine: cabin set back, the class's long nose
  'gt3-front': {cabinShiftX: -0.3, noseShorten: 0, wingScale: 1, roofScale: 1},
  // mid engine: cabin forward, a short nose
  'gt3-mid': {cabinShiftX: 0.4, noseShorten: 0.1, wingScale: 1, roofScale: 0.97},
  // rear engine (the 911): cabin forward, short nose, a taller roof and a lower wing than the class box
  'gt3-rear': {cabinShiftX: 0.2, noseShorten: 0.06, wingScale: 0.9, roofScale: 1.06},
  // Le Mans Hypercar prototypes: cabin forward, the fin, a lower wing
  lmh: {cabinShiftX: 0.2, noseShorten: 0, wingScale: 0.85, roofScale: 1},
  // LMDh prototypes: cabin set a little back, the class wing and fin
  lmdh: {cabinShiftX: -0.15, noseShorten: 0, wingScale: 1, roofScale: 1},
};

/**
 * The known models, in the order that gives each its tint step inside its family (carTint). A pattern is matched on the
 * lower-cased `vehicle` the field carries (`Ferrari 499P`, `Porsche 911 GT3 R LMGT3`, ...); the order is fixed so a
 * model keeps its step in every session.
 */
export const KNOWN: Record<Family, RegExp[]> = {
  lmh: [/499p/, /9x8/, /tr010|gr010/, /valkyrie/, /glickenhaus|007/],
  lmdh: [/cadillac|v-series/, /m hybrid/, /963/, /gmr-?001|genesis/, /a424|alpine/, /sc63|lamborghini/],
  'gt3-front': [/\bm4\b/, /mercedes|amg/, /mustang/, /vantage/, /\brc ?f\b|lexus/],
  'gt3-mid': [/720s|mclaren/, /296/, /corvette|z06/],
  'gt3-rear': [/911/],
};

const FAMILY_CLASS: Record<Family, string> = {lmh: 'Hyper', lmdh: 'Hyper', 'gt3-front': 'GT3', 'gt3-mid': 'GT3', 'gt3-rear': 'GT3'};

/** The family of a model within its class, with the model's place in the family; null for an unknown or missing model. */
export function familyOf(vehicle: string | null, carClass: string): {family: Family; slot: number} | null {
  const v = (vehicle ?? '').toLowerCase().trim();
  if (!v) return null;
  for (const family of Object.keys(KNOWN) as Family[]) {
    if (FAMILY_CLASS[family] !== carClass) continue;
    const slot = KNOWN[family].findIndex(re => re.test(v));
    if (slot >= 0) return {family, slot};
  }
  return null;
}

function scaled(shape: ClassShape, v: Variant): ClassShape {
  const nose = shape.hull[0][0];
  const tail = shape.hull[shape.hull.length - 1][0];
  const hull = shape.hull.map(([x, ...rest]) => [x > 0 ? x * (1 - v.noseShorten) : x, ...rest] as Station);
  // the glasshouse moves within the hull's own length
  const lo = tail + 0.3;
  const hi = nose - 0.4;
  const cabin = shape.cabin.map(
    ([x, w, sh, wt, top]) => [Math.max(lo, Math.min(hi, x + v.cabinShiftX)), w, sh, wt, sh + (top - sh) * v.roofScale] as Station,
  );
  const [wx, wy, chord, span] = shape.wing;
  const tailTop = hull[hull.length - 1][4];
  return {hull, cabin, wing: [wx, tailTop + (wy - tailTop) * v.wingScale, chord, span], fin: shape.fin};
}

/**
 * The shape to draw for a car: the class hull, or its family's variant. `key` names it for the kit's cache and `tint`
 * is the model's step inside its family (0 for a model with none). An unknown class uses GT3's, as before.
 */
export function shapeFor(
  vehicle: string | null,
  carClass: string,
): {key: string; shape: ClassShape; footprint: [number, number]; tint: number} {
  const cls = SHAPES[carClass] ? carClass : 'GT3';
  const footprint = SIZE[cls];
  const fam = familyOf(vehicle, cls);
  if (!fam) return {key: cls, shape: SHAPES[cls], footprint, tint: 0};
  return {key: `${cls}:${fam.family}`, shape: scaled(SHAPES[cls], VARIANTS[fam.family]), footprint, tint: fam.slot};
}