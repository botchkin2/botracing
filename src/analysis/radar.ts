// Cars around you (round 3 R2, docs/design_handoff_round3_field/README.md):
// every car near the player at one 5 Hz update, placed in the player's frame.
// Pure and import-free (erasable TypeScript only), so Node can run it.
//
// World x is east and z is north; heading 0 points along +z and π/2 along +x
// (the direction of atan2(Δx, Δz)), the same convention as Field.yawRad.

import {ABSENT, type Field, type FieldCar} from './field';

/** The player's own block: 2 × 4.6 m (R2). */
export const PLAYER_LENGTH_M = 4.6;
export const CAR_WIDTH_M = 2;
/** Cars fade out over FADE_M ending 4 m past the range edge (R2), not popping out. */
const FADE_M = 6;
/** Cars in the pit lane draw dimmer (R2). */
const PIT_OPACITY = 0.4;
/** Side bar: lit when a car overlaps yours lengthwise and is this close sideways. */
const SIDE_BAR_M = 6;

export type RadarClass = 'hypercar' | 'lmp2' | 'gt3';

/** Block length per class, metres (R2). */
const LENGTH_M: Record<RadarClass, number> = {
  hypercar: 5.0,
  lmp2: 4.7,
  gt3: 4.6,
};

/** LMU's class names ("Hyper", "LMP2", "GT3"); anything else draws as GT3. */
export function radarClass(carClass: string): RadarClass {
  const c = carClass.toLowerCase();
  if (c.includes('hyper')) return 'hypercar';
  if (c.includes('lmp2')) return 'lmp2';
  return 'gt3';
}

export interface RadarCar {
  /** Index in Field.cars. */
  index: number;
  cls: RadarClass;
  /** Metres ahead (+) or behind (−) the player's centre. */
  forwardM: number;
  /** Metres to the player's right (+) or left (−). */
  sideM: number;
  /** Heading relative to the player's, radians in (−π, π]; 0 = same way. */
  relYawRad: number;
  lengthM: number;
  widthM: number;
  /** 0..1: the range-edge fade times the pit dimming. */
  opacity: number;
}

export interface Radar {
  cars: RadarCar[];
  /** A car overlaps yours lengthwise and sits within SIDE_BAR_M on that side. */
  leftLit: boolean;
  rightLit: boolean;
}

function wrapPi(a: number): number {
  let r = (a + Math.PI) % (2 * Math.PI);
  if (r <= 0) r += 2 * Math.PI;
  return r - Math.PI;
}

const finite = (v: number) => !Number.isNaN(v);

/**
 * The cars within ±rangeM ahead and behind at update `at`. `halfWidthM` is the
 * radar's half width in metres (its aspect ratio × the range); cars further
 * out sideways are left out. Null when there is no player, no heading (files
 * before v2 carry none), or the player is absent at this update: the radar is
 * then not drawn rather than guessed from positions.
 */
export function radarAt(
  field: Field,
  at: number,
  rangeM: number,
  halfWidthM: number,
): Radar | null {
  const me = field.cars.find(c => c.player);
  if (!me || !me.yawRad || at < 0 || at >= field.timeS.length) return null;
  const px = me.xM[at];
  const pz = me.zM[at];
  const yaw = me.yawRad[at];
  if (!finite(px) || !finite(pz) || !finite(yaw)) return null;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);

  const cars: RadarCar[] = [];
  let leftLit = false;
  let rightLit = false;
  for (const car of field.cars) {
    if (car === me) continue;
    const placed = placeCar(car, at, px, pz, yaw, sin, cos);
    if (!placed) continue;
    const {forwardM, sideM} = placed;
    if (Math.abs(sideM) > halfWidthM) continue;
    const fade = Math.min(
      1,
      Math.max(0, (rangeM + 4 - Math.abs(forwardM)) / FADE_M),
    );
    const opacity = fade * (car.inPits[at] === 1 ? PIT_OPACITY : 1);
    if (opacity <= 0) continue;
    const cls = radarClass(car.carClass);
    const lengthM = LENGTH_M[cls];
    // A car in the pit lane alongside on pit entry or exit is not a car to
    // look for on track, so it does not light the bars.
    if (
      car.inPits[at] !== 1 &&
      Math.abs(forwardM) < (lengthM + PLAYER_LENGTH_M) / 2 &&
      Math.abs(sideM) < SIDE_BAR_M
    ) {
      if (sideM < 0) leftLit = true;
      else rightLit = true;
    }
    cars.push({
      index: car.index,
      cls,
      forwardM,
      sideM,
      relYawRad: placed.relYawRad,
      lengthM,
      widthM: CAR_WIDTH_M,
      opacity,
    });
  }
  return {cars, leftLit, rightLit};
}

function placeCar(
  car: FieldCar,
  at: number,
  px: number,
  pz: number,
  yaw: number,
  sin: number,
  cos: number,
): {forwardM: number; sideM: number; relYawRad: number} | null {
  const x = car.xM[at];
  const z = car.zM[at];
  if (!finite(x) || !finite(z) || car.place[at] === ABSENT) return null;
  const dx = x - px;
  const dz = z - pz;
  const h = car.yawRad ? car.yawRad[at] : NaN;
  return {
    forwardM: dx * sin + dz * cos,
    sideM: dx * cos - dz * sin,
    // A car with no heading of its own is drawn pointing the player's way.
    relYawRad: finite(h) ? wrapPi(h - yaw) : 0,
  };
}
