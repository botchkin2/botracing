// What one model changes on its class hull (ticket 59, pit-wall thread 124, design/car-shapes/reference-table.md): each
// field is a number the table's cue column names, in metres unless it says scale. A model is the class hull plus these
// edits; a field left out leaves the class value. Plain TypeScript, no three.js, so every edit is tested as numbers.

import type {Bulge, ClassShape, Station, WingKind} from './carShapes';

export interface ModelParams {
  /** The hull's length, nose to tail, after the other edits (they change its proportions, never its total). */
  lengthM?: number;
  /** Axle spacing; the axles stay centred on the class's own axle midpoint. */
  wheelbaseM?: number;
  /** The nose tip and the first station move forward (+) or back (-). */
  noseLen?: number;
  /** The nose stands taller (+) or lower (-). */
  noseH?: number;
  /** The nose is wider (+) or narrower (-), per side. */
  noseW?: number;
  /** The glasshouse moves forward (+) or back (-). */
  cabinX?: number;
  /** The glasshouse's length, scale about its own middle. */
  cabinLen?: number;
  /** The roof stands taller (+) or lower (-). */
  cabinTop?: number;
  /** The glasshouse's width, scale. */
  cabinW?: number;
  /** The roof falls toward the tail by this much, and the rear window runs further back: a fastback. */
  roofDrop?: number;
  /** The rear deck and tail stand taller (+) or lower (-). */
  deckH?: number;
  /** The tail reaches further behind the rear axle (+) or is cut short (-). */
  tailOver?: number;
  wingKind?: WingKind;
  /** The wing stands higher (+) or lower (-). */
  wingH?: number;
  /** The wing's span, scale. */
  wingSpan?: number;
  /** The dorsal fin's height, scale (a class with a fin only). */
  finH?: number;
  /** Raised pods on the hull: the front fender crests, rear haunches. */
  bulges?: Bulge[];
}

const MIN_ABOVE_SHOULDER = 0.02;
const WING_LOW_ABOVE_TAIL = 0.1;

const copy = (st: Station): Station => [...st] as Station;

/** A top height that never drops below its station's shoulder. */
const keepAbove = (st: Station) => {
  st[4] = Math.max(st[4], st[2] + MIN_ABOVE_SHOULDER);
};

/** The class hull with a model's edits applied; the class shape itself is never changed. */
export function applyParams(base: ClassShape, p: ModelParams): ClassShape {
  const hull = base.hull.map(copy);
  const last = hull.length - 1;
  const baseTail = base.hull[last][0];

  const dNoseLen = p.noseLen ?? 0;
  hull[0][0] += dNoseLen;
  hull[1][0] += dNoseLen * 0.6;
  const dNoseH = p.noseH ?? 0;
  hull[0][2] += dNoseH * 0.4;
  hull[0][4] += dNoseH;
  hull[1][2] += dNoseH * 0.4;
  hull[1][4] += dNoseH * 0.6;
  const dNoseW = p.noseW ?? 0;
  hull[0][1] += dNoseW;
  hull[0][3] += dNoseW * 0.6;
  hull[1][1] += dNoseW * 0.5;
  hull[1][3] += dNoseW * 0.3;
  const dDeck = p.deckH ?? 0;
  for (const i of [last - 2, last - 1]) {
    hull[i][2] += dDeck * 0.5;
    hull[i][4] += dDeck;
  }
  hull[last][2] += dDeck * 0.3;
  hull[last][4] += dDeck * 0.6;
  const dTail = p.tailOver ?? 0;
  hull[last][0] -= dTail;
  hull[last - 1][0] -= dTail * 0.6;
  for (const st of hull) keepAbove(st);

  let cabin = base.cabin.map(copy);
  const cabinMid = (cabin[0][0] + cabin[cabin.length - 1][0]) / 2;
  const lenScale = p.cabinLen ?? 1;
  const widthScale = p.cabinW ?? 1;
  const dTop = p.cabinTop ?? 0;
  const drop = p.roofDrop ?? 0;
  cabin = cabin.map((st, i) => {
    const out = copy(st);
    out[0] = cabinMid + (st[0] - cabinMid) * lenScale + (p.cabinX ?? 0);
    out[1] *= widthScale;
    out[3] *= widthScale;
    // the roof stations (the middle two) take the height, the windscreen and rear-window feet a fifth of it
    out[4] += i === 1 || i === 2 ? dTop : dTop * 0.2;
    if (i === 2) out[4] -= drop;
    if (i === cabin.length - 1) {
      out[4] -= drop;
      out[0] -= drop * 0.6;
    }
    keepAbove(out);
    return out;
  });
  // the glasshouse stays on the hull, between the tail's and the nose's own limits
  const lo = hull[last][0] + 0.3;
  const hi = hull[0][0] - 0.4;
  const shiftIn =
    Math.max(0, lo - Math.min(...cabin.map(st => st[0]))) -
    Math.max(0, Math.max(...cabin.map(st => st[0])) - hi);
  cabin = cabin.map(st => [st[0] + shiftIn, ...st.slice(1)] as Station);

  const [wx0, wy0, chord, span0] = base.wing;
  const kind: WingKind = p.wingKind ?? base.wingKind ?? 'stalks';
  const tailTop = hull[last][4];
  let wy = wy0 + (hull[last][4] - base.hull[last][4]) + (p.wingH ?? 0);
  if (kind === 'low') wy = tailTop + WING_LOW_ABOVE_TAIL + (p.wingH ?? 0);
  const wing: ClassShape['wing'] = [
    wx0 + (hull[last][0] - baseTail),
    wy,
    chord,
    span0 * (p.wingSpan ?? 1),
  ];
  let fin = base.fin && ([...base.fin] as [number, number, number]);
  if (fin && p.finH) fin = [fin[0], fin[1], fin[2] * p.finH];

  let out: ClassShape = {
    hull,
    cabin,
    wing,
    wingKind: kind,
    fin,
    wheels: base.wheels,
    bulges: p.bulges ?? base.bulges,
  };

  if (p.lengthM) {
    const nose = hull[0][0];
    const centre = (nose + hull[last][0]) / 2;
    const s = p.lengthM / (nose - hull[last][0]);
    const fit = (x: number) => centre + (x - centre) * s;
    out = {
      ...out,
      hull: hull.map(st => [fit(st[0]), ...st.slice(1)] as Station),
      cabin: cabin.map(st => [fit(st[0]), ...st.slice(1)] as Station),
      wing: [fit(wing[0]), wing[1], wing[2], wing[3]],
      fin: fin && [fit(fin[0]), fin[1] * s, fin[2]],
      bulges: out.bulges?.map(b => ({...b, x: fit(b.x), len: b.len * s})),
    };
  }

  const [front0, rear0, radius, width] = base.wheels;
  if (p.wheelbaseM) {
    const mid = (front0 + rear0) / 2;
    out.wheels = [
      mid + p.wheelbaseM / 2,
      mid - p.wheelbaseM / 2,
      radius,
      width,
    ];
  }
  return out;
}
