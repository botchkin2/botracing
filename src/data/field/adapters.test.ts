import {describe, expect, it} from '@jest/globals';

import {toField, toFieldPointer} from './adapters';

// As tools/sessions/field.mjs encodes it: two cars, three updates. Car 1 is
// absent in the second update (null keeps its last value for the next delta).
const raw = () => ({
  v: 2,
  hz: 5,
  et0: 1000,
  tDs: [0, 2, 4],
  cars: [
    {i: 0, class: 'GT3', vehicle: 'Porsche 911 GT3 R', player: true},
    {i: 1, class: 'LMP2', vehicle: null, player: false},
  ],
  lapDistDm: [
    [1000, 100, 110],
    [500, null, 100],
  ],
  pathLateralDm: [
    [-12, 1, 0],
    [5, null, 0],
  ],
  xDm: [
    [10, 10, 10],
    [20, null, 0],
  ],
  zDm: [
    [-10, -10, -10],
    [-20, null, 0],
  ],
  yawCrad: [
    [0, 157, 157],
    [-314, null, 628],
  ],
  place: [
    [1, 1, 1],
    [2, null, 2],
  ],
  laps: [
    [3, 3, 3],
    [3, null, 3],
  ],
  inPits: [
    [0, 0, 0],
    [0, null, 1],
  ],
  flag: [
    [0, 0, 0],
    [6, null, 0],
  ],
});

describe('toField', () => {
  it('sums the deltas into metres and radians, keeping gaps as null', () => {
    const f = toField(raw());
    expect(f.version).toBe(2);
    expect(f.timeS).toEqual([0, 0.2, 0.4]);
    expect(f.startEtS).toBe(1000);
    const [player, other] = f.cars;
    expect(player.player).toBe(true);
    expect(player.vehicle).toBe('Porsche 911 GT3 R');
    expect(player.lapDistM.map(v => v && Math.round(v))).toEqual([
      100, 110, 121,
    ]);
    expect(other.lapDistM.map(v => v && Math.round(v))).toEqual([50, null, 60]);
    expect(other.xM.map(v => v && Math.round(v))).toEqual([2, null, 2]);
    expect(other.inPits).toEqual([false, null, true]);
    expect(other.flag).toEqual([6, null, 0]);
    expect(other.carClass).toBe('LMP2');
    expect(other.vehicle).toBeNull();
  });

  it('turns centiradians into radians; the wrap sums back to a wrapped heading', () => {
    const f = toField(raw());
    expect(f.cars[0].yawRad?.map(v => v && +v.toFixed(2))).toEqual([
      0, 1.57, 3.14,
    ]);
    // -314 then +628 is the step over the ±π seam, ending at +314.
    expect(f.cars[1].yawRad?.map(v => v && +v.toFixed(2))).toEqual([
      -3.14,
      null,
      3.14,
    ]);
  });

  it('reads a v1 file with no heading as yawRad null', () => {
    const v1 = raw() as Record<string, unknown>;
    v1.v = 1;
    delete v1.yawCrad;
    const f = toField(v1);
    expect(f.version).toBe(1);
    expect(f.cars.every(c => c.yawRad === null)).toBe(true);
  });

  it('names the field that is wrong instead of returning holes', () => {
    const short = raw();
    short.xDm = [[10, 10, 10]];
    expect(() => toField(short)).toThrow('xDm needs one array per car');
    const ragged = raw();
    ragged.place[1] = [2, null];
    expect(() => toField(ragged)).toThrow('place[1] needs 3 updates');
    const text = raw() as Record<string, unknown>;
    (text.flag as unknown[][])[0][1] = 'x';
    expect(() => toField(text)).toThrow('flag[0][1] is not a number');
    expect(() => toField({})).toThrow('v is missing');
  });
});

describe('toFieldPointer', () => {
  it('reads the session doc block, null without a hash', () => {
    expect(
      toFieldPointer({hash: 'abc123def456', hz: 5, cars: 62, durationS: 931}),
    ).toEqual({hash: 'abc123def456', hz: 5, cars: 62, durationS: 931});
    expect(toFieldPointer(undefined)).toBeNull();
    expect(toFieldPointer({hz: 5})).toBeNull();
  });
});
