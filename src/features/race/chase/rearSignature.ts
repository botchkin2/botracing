// What tells two models apart from behind, as numbers (pit-wall thread 124, steward #8200 and scout #8201). At 20 m a
// phone shows about 21 px a metre, so a body step under ~15 cm is not there on the screen; a model's rear counts as a
// different one only past that line, or by kind. A class passes when every pair of its models differs in at least
// MIN_DIFFERENCES of these features (rearSignature.test.ts): a car nobody could tell apart fails in CI, before a sheet.

import {shapeFor} from './carShapes';

/** A step in metres counts as visible from the pack at about this size (steward #8200). */
export const VISIBLE_M = 0.15;
/** Every pair of models in a class differs in at least this many rear features. */
export const MIN_DIFFERENCES = 2;

export interface RearSignature {
  wingKind: string;
  /** The wing's top, metres. */
  wingTopM: number;
  /** The tail's half-widths at the sill and at the roof line, metres. */
  tailHalfW: [sill: number, top: number];
  /** The deck's top height just before the tail, metres. */
  deckTopM: number;
  /** An end plate's height above the wing; 0 for none. */
  endPlateM: number;
  /** The dorsal fin's height, metres; 0 for none. */
  finM: number;
  /** The light pattern on the tail face, as its segments. */
  lights: string;
}

export function rearSignature(
  vehicle: string,
  carClass: string,
): RearSignature {
  const {shape} = shapeFor(vehicle, carClass);
  const n = shape.hull.length;
  return {
    wingKind: shape.wingKind ?? 'stalks',
    wingTopM: shape.wing[1],
    tailHalfW: [shape.hull[n - 1][1], shape.hull[n - 1][3]],
    deckTopM: shape.hull[n - 2][4],
    endPlateM: shape.endPlate?.h ?? 0,
    finM: shape.fin?.[2] ?? 0,
    lights: JSON.stringify(shape.tailLights ?? []),
  };
}

/** The rear features in which two signatures differ: by kind or pattern, or by VISIBLE_M or more. */
export function differingFeatures(
  a: RearSignature,
  b: RearSignature,
): string[] {
  const far = (x: number, y: number) => Math.abs(x - y) >= VISIBLE_M - 1e-9;
  const out: string[] = [];
  if (a.wingKind !== b.wingKind) out.push('wing kind');
  if (far(a.wingTopM, b.wingTopM)) out.push('wing height');
  if (
    far(a.tailHalfW[0], b.tailHalfW[0]) ||
    far(a.tailHalfW[1], b.tailHalfW[1])
  )
    out.push('tail width');
  if (far(a.deckTopM, b.deckTopM)) out.push('deck height');
  if (far(a.endPlateM, b.endPlateM)) out.push('end plate');
  if (far(a.finM, b.finM)) out.push('fin height');
  if (a.lights !== b.lights) out.push('light pattern');
  return out;
}
