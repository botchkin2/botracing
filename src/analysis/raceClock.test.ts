import {describe, expect, it} from '@jest/globals';

import {ABSENT, type Field, type FieldCar} from './field';
import {raceClock, raceStartS} from './raceClock';

const HZ = 5;

// A player on a 100 m track, `perUpdate` metres per update, starting at `from`
// metres into lap `lap0`. `bumpLate` moves the laps-completed increment one
// update after the distance wraps; `bumpEarly` one update before.
function player(
  updates: number,
  opts: {
    from?: number;
    lap0?: number;
    perUpdate?: number;
    bump?: 'exact' | 'late' | 'early';
    absent?: number[];
  } = {},
): FieldCar {
  const {
    from = 0,
    lap0 = 0,
    perUpdate = 10,
    bump = 'exact',
    absent = [],
  } = opts;
  const c: FieldCar = {
    index: 0,
    carClass: 'GT3',
    classId: null,
    classLabel: null,
    vehicle: null,
    player: true,
    lapDistM: new Float32Array(updates),
    pathLateralM: new Float32Array(updates),
    xM: new Float32Array(updates),
    zM: new Float32Array(updates),
    yawRad: null,
    place: new Int16Array(updates),
    lapsDone: new Int16Array(updates),
    inPits: new Int8Array(updates),
    flag: new Int16Array(updates),
  };
  for (let u = 0; u < updates; u++) {
    if (absent.includes(u)) {
      c.lapDistM[u] = NaN;
      c.lapsDone[u] = ABSENT;
      continue;
    }
    const total = from + u * perUpdate;
    c.lapDistM[u] = total % 100;
    const wraps = Math.floor(total / 100);
    const shift = bump === 'late' ? -1 : bump === 'early' ? 1 : 0;
    // Distance wraps at total 100; the counter follows `shift` updates away.
    const t2 = total + shift * perUpdate;
    c.lapsDone[u] = lap0 + (bump === 'exact' ? wraps : Math.floor(t2 / 100));
  }
  return c;
}

// A parked second car at 100 m gives the field its lap length, as the other
// cars do in a real field.
function field(car: FieldCar, updates: number): Field {
  const marker: FieldCar = {
    ...car,
    index: 1,
    player: false,
    lapDistM: new Float32Array(updates).fill(100),
  };
  return {
    version: 2,
    hz: HZ,
    hasPositions: true,
    startEtS: 0,
    timeS: Float64Array.from({length: updates}, (_, u) => u / HZ),
    cars: [car, marker],
  };
}

describe('raceClock.playerAt', () => {
  it('gives the lap number and distance at the nearest update', () => {
    const f = field(player(30, {from: 20, lap0: 3}), 30);
    // Update 9 is 110 m in: lap 4, 10 m.
    expect(raceClock(f).playerAt(9 / HZ)).toEqual({
      lapNumber: 4,
      distanceM: 10,
    });
    expect(raceClock(f).playerAt(0)).toEqual({lapNumber: 3, distanceM: 20});
  });

  it('uses the game lapsDone when no car wrapped (no invented length)', () => {
    const car = player(20, {from: 50, perUpdate: 0, lap0: 2});
    const f: Field = {
      version: 2,
      hz: HZ,
      hasPositions: true,
      startEtS: 0,
      timeS: Float64Array.from({length: 20}, (_, u) => u / HZ),
      cars: [car],
    };
    expect(raceClock(f).playerAt(1)).toEqual({
      lapNumber: 2,
      distanceM: 50,
    });
  });

  it('is null with no player or while the player is absent', () => {
    const noPlayer = field({...player(5), player: false}, 5);
    expect(raceClock(noPlayer).playerAt(0)).toBeNull();
    const gone = field(player(5, {absent: [2]}), 5);
    expect(raceClock(gone).playerAt(2 / HZ)).toBeNull();
  });

  it('keeps the lap right when the counter bumps an update late or early', () => {
    // 10 m per update on a 100 m track: the distance wraps at update 10.
    const late = field(player(14, {bump: 'late'}), 14);
    const early = field(player(14, {bump: 'early'}), 14);
    for (const f of [late, early]) {
      expect(raceClock(f).playerAt(9 / HZ)?.lapNumber).toBe(0); // 90 m into lap 0
      expect(raceClock(f).playerAt(10 / HZ)?.lapNumber).toBe(1); // 0 m into lap 1
      expect(raceClock(f).playerAt(11 / HZ)?.lapNumber).toBe(1);
    }
  });
});

describe('raceClock.timeAtLapDistance', () => {
  const f = field(player(30, {from: 20, lap0: 3}), 30);

  it('finds the moment, interpolating between updates', () => {
    // Lap 4: 10 m at update 9, 20 m at update 10, so 15 m is at 9.5.
    expect(raceClock(f).timeAtLapDistance(4, 15)).toBeCloseTo(9.5 / HZ, 6);
    expect(raceClock(f).timeAtLapDistance(3, 50)).toBeCloseTo(3 / HZ, 6);
  });

  it('returns the first sample of the lap for a distance before it', () => {
    // Lap 4 starts at update 8 (0 m); asking before its first sample is 0 m.
    expect(raceClock(f).timeAtLapDistance(4, 0)).toBeCloseTo(8 / HZ, 6);
  });

  it('interpolates from the last sample of the lap before, across the line', () => {
    // Starting 25 m in: lap 4's first sample is 5 m at update 8, the update
    // before is 95 m on lap 3. 2 m into lap 4 is 7 of the 10 m between them.
    const g = field(player(30, {from: 25, lap0: 3}), 30);
    expect(raceClock(g).timeAtLapDistance(4, 2)).toBeCloseTo((7 + 0.7) / HZ, 6);
  });

  it('is null for a lap not driven or a distance the lap never reached', () => {
    expect(raceClock(f).timeAtLapDistance(1, 10)).toBeNull();
    // Lap 3 ends at 90 m (update 7); lap 6 has only 10 m at the last update.
    expect(raceClock(f).timeAtLapDistance(3, 95)).toBeNull();
    expect(raceClock(f).timeAtLapDistance(6, 50)).toBeNull();
  });

  it('does not interpolate across an absent stretch', () => {
    const gap = field(player(20, {absent: [4, 5]}), 20);
    // Lap 0: 30 m at update 3, absent at 4-5, 60 m at update 6. 45 m is in
    // the gap: the first sample at or past it is update 6, not a blend.
    expect(raceClock(gap).timeAtLapDistance(0, 45)).toBeCloseTo(6 / HZ, 6);
  });

  it('round-trips with playerAt', () => {
    const at = raceClock(f).playerAt(12 / HZ);
    expect(at).not.toBeNull();
    const t = raceClock(f).timeAtLapDistance(at!.lapNumber, at!.distanceM);
    expect(t).toBeCloseTo(12 / HZ, 6);
  });
});

describe('the start of a race from a grid behind the line (pit wall thread 91)', () => {
  // His 2026-10-15 Silverstone race, on a 100 m track at 10 m an update: a
  // formation lap from behind the line, onto the grid behind it again (lap
  // distance negative), the start, then the game's counter reads 1 only after
  // a full racing lap (mTotalLaps stayed 0 from the grid to 274 s).
  const rows: [number, number][] = [
    [-15, 0],
    [-5, 0],
    ...Array.from({length: 10}, (_, i): [number, number] => [5 + i * 10, 0]),
    [-3, 0],
    [-3, 0],
    [-3, 0],
    ...Array.from({length: 10}, (_, i): [number, number] => [7 + i * 10, 0]),
    ...Array.from({length: 10}, (_, i): [number, number] => [7 + i * 10, 1]),
    [7, 2],
    [17, 2],
  ];
  const car = player(rows.length);
  rows.forEach(([d, laps], u) => {
    car.lapDistM[u] = d;
    car.lapsDone[u] = laps;
  });
  const f = field(car, rows.length);
  // Grid at u 12-14 (-3 m), across the line at u 15 (7 m): 2.8 s + 0.3 of an update.
  const startS = 14 / HZ + 0.3 / HZ;

  it('lap 1 starts at the start crossing, not at the formation lap', () => {
    expect(raceClock(f).timeAtLapDistance(0, 0)).toBeCloseTo(startS, 6);
  });
  it('lap 2 starts where the counter first moves, one full lap later', () => {
    // The interpolation from the lap before uses the field's estimated length.
    expect(raceClock(f).timeAtLapDistance(1, 0)).toBeCloseTo(
      24 / HZ + 0.3 / HZ,
      1,
    );
  });
  it('the race starts at the first start crossing', () => {
    expect(raceStartS(f)).toBeCloseTo(startS, 6);
  });
  it('no start when no car completes its first lap in the field', () => {
    const n = 22;
    const short = player(n);
    rows.slice(0, n).forEach(([d], u) => {
      short.lapDistM[u] = d;
      short.lapsDone[u] = 0;
    });
    expect(raceStartS(field(short, n))).toBeNull();
  });
});

describe('a counter already at 1 when the flag drops (Daytona 10-07)', () => {
  // 100 m track, 10 m an update. The formation wrap is more than 2 s before
  // the start, and lapsDone is 1 from the green sample through the lap.
  const rows: [number, number][] = [
    [80, 0],
    [90, 0],
    [-10, 0],
    ...Array.from({length: 12}, (): [number, number] => [-5, 0]),
    [-5, 1],
    [5, 1],
    ...Array.from({length: 9}, (_, i): [number, number] => [15 + i * 10, 1]),
    [5, 2],
  ];
  const car = player(rows.length);
  rows.forEach(([d, laps], u) => {
    car.lapDistM[u] = d;
    car.lapsDone[u] = laps;
  });
  const f = field(car, rows.length);
  // Grid ends at u 15 (-5 m); the next sample is across the line.
  const startS = 15 / HZ + 0.5 / HZ;
  // The next line is the last sample, coming from 95 m.
  const lap2S = (rows.length - 2) / HZ + 0.5 / HZ;

  it('lap 1 is the start crossing', () => {
    expect(raceClock(f).timeAtLapDistance(0, 0)).toBeCloseTo(startS, 6);
  });
  it('lap 2 is the next start/finish, not a quarter of the lap', () => {
    expect(raceClock(f).timeAtLapDistance(1, 0)).toBeCloseTo(lap2S, 6);
  });
});

describe('a reset mid-lap is unchanged (chord #5980)', () => {
  // Lap 1 driven to 30 m, a reset (absent two updates), then back on the same
  // lap from 5 m. Only a wrap the counter never confirms restarts a lap's
  // run; a reset does not, so the first run still answers, as on main.
  const rows: [number, number][] = [
    [0, 1],
    [10, 1],
    [20, 1],
    [30, 1],
    [NaN, ABSENT],
    [NaN, ABSENT],
    [5, 1],
    [15, 1],
    [25, 1],
    [35, 1],
  ];
  const car = player(rows.length);
  rows.forEach(([d, laps], u) => {
    car.lapDistM[u] = d;
    car.lapsDone[u] = laps;
  });
  const f = field(car, rows.length);
  it('a distance in both attempts reads from the first', () => {
    expect(raceClock(f).timeAtLapDistance(1, 20)).toBeCloseTo(2 / HZ, 6);
  });
  it('a distance only the second attempt reaches reads from it', () => {
    expect(raceClock(f).timeAtLapDistance(1, 35)).toBeCloseTo(9 / HZ, 6);
  });
});
