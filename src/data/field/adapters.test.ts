import {describe, expect, it} from '@jest/globals';

import {ABSENT} from '@/src/analysis/field';

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

// Float32 values back to plain numbers, NaN (absent) to null, rounded.
const plain = (a: ArrayLike<number> | null, digits = 1) =>
  a && Array.from(a, v => (Number.isNaN(v) ? null : +v.toFixed(digits)));

describe('toField', () => {
  it('says whether the cars have positions, from the data and not the sim', () => {
    expect(toField(raw()).hasPositions).toBe(true);
    // iRacing's field: lap distance only, every position channel absent.
    const lapDistOnly = {
      ...raw(),
      pathLateralDm: [
        [null, null, null],
        [null, null, null],
      ],
      xDm: [
        [null, null, null],
        [null, null, null],
      ],
      zDm: [
        [null, null, null],
        [null, null, null],
      ],
      yawCrad: [
        [null, null, null],
        [null, null, null],
      ],
    };
    const f = toField(lapDistOnly);
    expect(f.hasPositions).toBe(false);
    expect(Number.isNaN(f.cars[0].xM[0])).toBe(true);
    expect(f.cars[0].lapDistM[0]).toBeCloseTo(100);
  });

  it('sums the deltas into metres and radians, keeping gaps absent', () => {
    const f = toField(raw());
    expect(f.version).toBe(2);
    expect(Array.from(f.timeS)).toEqual([0, 0.2, 0.4]);
    expect(f.startEtS).toBe(1000);
    const [player, other] = f.cars;
    expect(player.player).toBe(true);
    expect(player.vehicle).toBe('Porsche 911 GT3 R');
    expect(plain(player.lapDistM)).toEqual([100, 110, 121]);
    expect(plain(other.lapDistM)).toEqual([50, null, 60]);
    expect(plain(other.xM)).toEqual([2, null, 2]);
    expect(Array.from(other.inPits)).toEqual([0, ABSENT, 1]);
    expect(Array.from(other.flag)).toEqual([6, ABSENT, 0]);
    expect(Array.from(other.place)).toEqual([2, ABSENT, 2]);
    expect(other.carClass).toBe('LMP2');
    expect(other.vehicle).toBeNull();
  });

  it('turns centiradians into radians; the wrap sums back to a wrapped heading', () => {
    const f = toField(raw());
    expect(plain(f.cars[0].yawRad, 2)).toEqual([0, 1.57, 3.14]);
    // -314 then +628 is the step over the ±π seam, ending at +314.
    expect(plain(f.cars[1].yawRad, 2)).toEqual([-3.14, null, 3.14]);
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

  // An hour of 62 cars is 10 million values (camber, thread 30 #807). Twenty
  // minutes here keeps the test light and shows the layout: typed arrays, a
  // fixed number of bytes per value, nothing left as number[].
  it('holds a long field in typed arrays', () => {
    const cars = 62;
    const updates = 6000;
    const rows = (v: number | null) =>
      Array.from({length: cars}, () =>
        new Array<number | null>(updates).fill(v),
      );
    const long = {
      v: 2,
      hz: 5,
      et0: 0,
      tDs: Array.from({length: updates}, (_, u) => u * 2),
      cars: Array.from({length: cars}, (_, i) => ({
        i,
        class: 'GT3',
        vehicle: null,
        player: i === 0,
      })),
      lapDistDm: rows(4),
      pathLateralDm: rows(0),
      xDm: rows(1),
      zDm: rows(1),
      yawCrad: rows(0),
      place: rows(1),
      laps: rows(1),
      inPits: rows(0),
      flag: rows(0),
    };
    const f = toField(long);
    let bytes = f.timeS.byteLength;
    for (const c of f.cars) {
      for (const channel of [
        c.lapDistM,
        c.pathLateralM,
        c.xM,
        c.zM,
        c.yawRad,
        c.place,
        c.lapsDone,
        c.inPits,
        c.flag,
      ]) {
        expect(ArrayBuffer.isView(channel)).toBe(true);
        bytes += channel?.byteLength ?? 0;
      }
    }
    // 5 float32 + 3 int16 + 1 int8 per car per update: 27 bytes, not ~9 boxed.
    expect(bytes).toBe(updates * 8 + cars * updates * 27);
    // The running sum is exact across the whole run: 4 dm per update.
    expect(f.cars[5].lapDistM[updates - 1]).toBeCloseTo(updates * 0.4, 1);
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
