import {describe, expect, it} from '@jest/globals';

import {type Field, type FieldCar} from './field';
import {placeFieldOnLine, pointOnLine} from './fieldOnLine';

// A 4-point square lap, 5 m apart: (0,0) -> (5,0) -> (5,5) -> (0,5) -> back.
const square = [
  {x: 0, y: 0},
  {x: 5, y: 0},
  {x: 5, y: 5},
  {x: 0, y: 5},
];
const STEP = 5;

const car = (index: number, player: boolean, lapDist: number[]): FieldCar => {
  const n = lapDist.length;
  return {
    index,
    carClass: 'GT3',
    classId: null,
    classLabel: null,
    vehicle: null,
    player,
    lapDistM: Float32Array.from(lapDist),
    pathLateralM: new Float32Array(n).fill(NaN),
    xM: new Float32Array(n).fill(NaN),
    zM: new Float32Array(n).fill(NaN),
    yawRad: null,
    place: new Int16Array(n).fill(1),
    lapsDone: new Int16Array(n).fill(2),
    inPits: new Int8Array(n),
    flag: new Int16Array(n),
  };
};

describe('pointOnLine', () => {
  it('interpolates along the line and heads along it', () => {
    const p = pointOnLine(square, STEP, 2.5)!;
    expect(p.x).toBeCloseTo(2.5);
    expect(p.z).toBeCloseTo(0);
    // Along +x: π/2 in the Field convention (0 along +z).
    expect(p.yawRad).toBeCloseTo(Math.PI / 2);
    const q = pointOnLine(square, STEP, 7.5)!;
    expect([q.x, q.z]).toEqual([5, 2.5]);
    expect(q.yawRad).toBeCloseTo(0);
  });

  it('wraps past the end of the lap and before the start', () => {
    const end = pointOnLine(square, STEP, 17.5)!; // 20 m lap: 3 m before the line
    expect([end.x, end.z]).toEqual([0, 2.5]);
    const wrapped = pointOnLine(square, STEP, 22.5)!;
    expect(wrapped.x).toBeCloseTo(2.5);
    const back = pointOnLine(square, STEP, -2.5)!;
    expect([back.x, back.z]).toEqual([0, 2.5]);
  });

  it('has nothing for a car that is not there or a line that is no line', () => {
    expect(pointOnLine(square, STEP, NaN)).toBeNull();
    expect(pointOnLine([{x: 0, y: 0}], STEP, 1)).toBeNull();
    expect(pointOnLine(square, 0, 1)).toBeNull();
  });
});

describe('placeFieldOnLine', () => {
  const base: Field = {
    version: 2,
    hz: 5,
    hasPositions: false,
    startEtS: 0,
    timeS: Float64Array.from([0, 0.2]),
    cars: [car(0, true, [2.5, 7.5]), car(1, false, [NaN, 12.5])],
  };

  it('puts every car at its lap distance on the line and says it has positions', () => {
    const placed = placeFieldOnLine(base, square, STEP);
    expect(placed.hasPositions).toBe(true);
    // Marked, so nothing draws a radar from it.
    expect(placed.placedOnLine).toBe(true);
    expect(base.placedOnLine).toBeUndefined();
    expect([placed.cars[0].xM[0], placed.cars[0].zM[0]]).toEqual([2.5, 0]);
    expect([placed.cars[0].xM[1], placed.cars[0].zM[1]]).toEqual([5, 2.5]);
    expect(placed.cars[0].yawRad![0]).toBeCloseTo(Math.PI / 2);
    // The offset from the line is unknown, not 0.
    expect(Number.isNaN(placed.cars[0].pathLateralM[0])).toBe(true);
    // Absent stays absent.
    expect(Number.isNaN(placed.cars[1].xM[0])).toBe(true);
    expect(Number.isNaN(placed.cars[1].yawRad![0])).toBe(true);
    expect([placed.cars[1].xM[1], placed.cars[1].zM[1]]).toEqual([2.5, 5]);
  });

  it('leaves the stored field and everything but the positions alone', () => {
    const placed = placeFieldOnLine(base, square, STEP);
    expect(base.hasPositions).toBe(false);
    expect(Number.isNaN(base.cars[0].xM[0])).toBe(true);
    expect(placed.cars[0].lapDistM).toBe(base.cars[0].lapDistM);
    expect(placed.cars[0].place).toBe(base.cars[0].place);
    expect(placed.timeS).toBe(base.timeS);
    expect(placed.cars[0].player).toBe(true);
  });
});
