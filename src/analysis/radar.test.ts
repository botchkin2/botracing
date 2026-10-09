import {describe, expect, it} from '@jest/globals';

import {fieldClasses} from './fieldClasses';
import {type Field, type FieldCar} from './field';
import {radarAt, radarClass} from './radar';

// One update; x east, z north. Heading 0 = north, π/2 = east.
function car(
  index: number,
  x: number,
  z: number,
  over: Partial<{
    player: boolean;
    cls: string;
    yaw: number | null;
    pit: number;
    place: number;
  }> = {},
): FieldCar {
  const yaw = over.yaw === undefined ? 0 : over.yaw;
  return {
    index,
    carClass: over.cls ?? 'GT3',
    classId: null,
    classLabel: null,
    vehicle: null,
    player: over.player ?? false,
    lapDistM: new Float32Array([0]),
    pathLateralM: new Float32Array([0]),
    xM: new Float32Array([x]),
    zM: new Float32Array([z]),
    yawRad: yaw === null ? null : new Float32Array([yaw]),
    place: new Int16Array([over.place ?? index + 1]),
    lapsDone: new Int16Array([0]),
    inPits: new Int8Array([over.pit ?? 0]),
    flag: new Int16Array([0]),
  };
}

const field = (cars: FieldCar[]): Field => ({
  version: 2,
  hz: 5,
  hasPositions: true,
  startEtS: 0,
  timeS: new Float64Array([0]),
  cars,
});

const me = (x = 100, z = 200, yaw = 0) =>
  car(0, x, z, {player: true, yaw, place: 1});

const R = 30;
const HALF_W = 20;
// The radar's geometry does not depend on the classes: every car is `other` here.
const NO_CLASSES = fieldClasses({timeS: [], cars: []});

describe('radarAt', () => {
  it('puts a car ahead at +forward and to the right at +side', () => {
    const r = radarAt(
      field([me(), car(1, 105, 220)]),
      0,
      R,
      HALF_W,
      NO_CLASSES,
    )!;
    expect(r.cars).toHaveLength(1);
    expect(r.cars[0].forwardM).toBeCloseTo(20);
    expect(r.cars[0].sideM).toBeCloseTo(5);
  });

  it('rotates into the player heading: facing east, north is to the left', () => {
    const r = radarAt(
      field([me(100, 200, Math.PI / 2), car(1, 100, 210)]),
      0,
      R,
      HALF_W,
      NO_CLASSES,
    )!;
    expect(r.cars[0].forwardM).toBeCloseTo(0);
    expect(r.cars[0].sideM).toBeCloseTo(-10);
  });

  it('gives a heading relative to the player', () => {
    const r = radarAt(
      field([me(), car(1, 100, 210, {yaw: Math.PI / 2})]),
      0,
      R,
      HALF_W,
      NO_CLASSES,
    )!;
    expect(r.cars[0].relYawRad).toBeCloseTo(Math.PI / 2);
  });

  it('fades over the last 6 m of range, dims pit cars, drops what is out', () => {
    const at = (z: number, pit = 0) =>
      radarAt(
        field([me(), car(1, 100, 200 + z, {pit})]),
        0,
        R,
        HALF_W,
        NO_CLASSES,
      )!.cars;
    expect(at(20)[0].opacity).toBe(1);
    expect(at(31)[0].opacity).toBeCloseTo(0.5);
    expect(at(40)).toHaveLength(0);
    expect(at(10, 1)[0].opacity).toBeCloseTo(0.4);
  });

  it('leaves out cars beyond the radar sideways', () => {
    const r = radarAt(
      field([me(), car(1, 130, 200)]),
      0,
      R,
      HALF_W,
      NO_CLASSES,
    )!;
    expect(r.cars).toEqual([]);
  });

  it('lights the side bar for a car alongside, on its side', () => {
    const left = radarAt(
      field([me(), car(1, 97, 201)]),
      0,
      R,
      HALF_W,
      NO_CLASSES,
    )!;
    expect([left.leftLit, left.rightLit]).toEqual([true, false]);
    const right = radarAt(
      field([me(), car(1, 103, 199)]),
      0,
      R,
      HALF_W,
      NO_CLASSES,
    )!;
    expect([right.leftLit, right.rightLit]).toEqual([false, true]);
    const behind = radarAt(
      field([me(), car(1, 103, 190)]),
      0,
      R,
      HALF_W,
      NO_CLASSES,
    )!;
    expect([behind.leftLit, behind.rightLit]).toEqual([false, false]);
  });

  it('does not light the side bars for a car in the pit lane', () => {
    const r = radarAt(
      field([me(), car(1, 97, 201, {pit: 1})]),
      0,
      R,
      HALF_W,
      NO_CLASSES,
    )!;
    expect(r.cars).toHaveLength(1);
    expect([r.leftLit, r.rightLit]).toEqual([false, false]);
  });

  it('is null without a heading, a player or a position', () => {
    const noYaw = field([car(0, 1, 1, {player: true, yaw: null})]);
    expect(radarAt(noYaw, 0, R, HALF_W, NO_CLASSES)).toBeNull();
    expect(radarAt(field([car(1, 0, 0)]), 0, R, HALF_W, NO_CLASSES)).toBeNull();
    expect(radarAt(field([me(NaN)]), 0, R, HALF_W, NO_CLASSES)).toBeNull();
  });

  it('skips cars that are absent at this update', () => {
    const gone = car(1, 100, 210, {place: -1});
    expect(
      radarAt(field([me(), gone]), 0, R, HALF_W, NO_CLASSES)!.cars,
    ).toEqual([]);
  });
});

describe('radarClass', () => {
  it('reads the sim class names', () => {
    expect(radarClass('Hyper')).toBe('hypercar');
    expect(radarClass('LMP2_ELMS')).toBe('lmp2');
    expect(radarClass('GT3')).toBe('gt3');
    expect(radarClass('')).toBe('gt3');
  });
});
