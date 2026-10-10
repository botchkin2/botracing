import {describe, expect, it} from '@jest/globals';

import {carLapsOf, lapLabelOffset} from './carLaps';
import realLaps from './__fixtures__/roadAtlantaPlayerLaps.json';
import {ABSENT, type Field, type FieldCar} from './field';

const DT = 0.2;
const L = 4000;

type Spec = {
  lapS: number;
  offsetM?: number;
  // Update ranges (inclusive start, exclusive end) the car is in the pits / absent.
  pits?: [number, number][];
  absent?: [number, number][];
};

const within = (u: number, ranges: [number, number][] = []) =>
  ranges.some(([a, b]) => u >= a && u < b);

function car(index: number, spec: Spec, updates: number): FieldCar {
  const lapDistM = new Float32Array(updates);
  const inPits = new Int8Array(updates);
  const lapsDone = new Int16Array(updates);
  for (let u = 0; u < updates; u++) {
    const along = (u * DT * L) / spec.lapS + (spec.offsetM ?? 0);
    lapDistM[u] = along % L;
    lapsDone[u] = Math.floor(along / L);
    inPits[u] = within(u, spec.pits) ? 1 : 0;
    if (within(u, spec.absent)) {
      lapDistM[u] = NaN;
      inPits[u] = ABSENT;
      lapsDone[u] = ABSENT;
    }
  }
  const z = new Float32Array(updates);
  return {
    index,
    carClass: 'GT3',
    classId: null,
    classLabel: null,
    vehicle: null,
    player: index === 0,
    lapDistM,
    pathLateralM: z,
    xM: z,
    zM: z,
    yawRad: null,
    place: new Int16Array(updates).fill(1),
    lapsDone,
    inPits,
    flag: new Int16Array(updates),
  };
}

function field(specs: Spec[], updates: number, hasPositions = true): Field {
  return {
    version: 2,
    hz: 5,
    hasPositions,
    startEtS: 0,
    timeS: Float64Array.from({length: updates}, (_, u) => u * DT),
    cars: specs.map((s, i) => car(i, s, updates)),
  };
}

// 100 s per lap at 5 Hz: 500 updates a lap.
const LAP_UPDATES = 500;

describe('carLapsOf', () => {
  it('times each lap between line crossings; the partial first lap is not listed', () => {
    const laps = carLapsOf(
      field([{lapS: 100, offsetM: 1000}], 3 * LAP_UPDATES),
      0,
    );
    expect(laps.map(l => l.lapNumber)).toEqual([2, 3]);
    for (const l of laps) {
      expect(l.timeS).toBeCloseTo(100, 1);
      expect(l.pit).toBeNull();
    }
  });

  it('tags the lap that ends in the pits "in" and the next "out"', () => {
    // Crossings fall near updates 487, 987, 1487, 1987.
    const pitUpdates: [number, number][] = [[980, 1020]];
    const laps = carLapsOf(
      field([{lapS: 100, offsetM: 100, pits: pitUpdates}], 4 * LAP_UPDATES),
      0,
    );
    expect(laps.map(l => l.pit)).toEqual(['in', 'out', null]);
  });

  it('tags a lap with pit time in the middle "pit"', () => {
    const laps = carLapsOf(
      field([{lapS: 100, offsetM: 100, pits: [[1200, 1220]]}], 4 * LAP_UPDATES),
      0,
    );
    expect(laps.map(l => l.pit)).toEqual([null, 'pit', null]);
  });

  it('shows no time for a lap the car left the field during, then times the next', () => {
    const laps = carLapsOf(
      field(
        [{lapS: 100, offsetM: 100, absent: [[1100, 1150]]}],
        4 * LAP_UPDATES,
      ),
      0,
    );
    expect(laps.map(l => l.timeS === null)).toEqual([false, true, false]);
  });

  it('starts a car that joins mid-session at its first crossing', () => {
    // Absent for the first 700 updates: its first crossing is near update 987.
    const laps = carLapsOf(
      field(
        [{lapS: 100}, {lapS: 100, offsetM: 100, absent: [[0, 700]]}],
        4 * LAP_UPDATES,
      ),
      1,
    );
    expect(laps).toHaveLength(2);
    expect(laps.every(l => l.timeS !== null)).toBe(true);
  });

  it('is empty for an unknown car and for a field nobody wrapped in', () => {
    const f = field([{lapS: 100}], 3 * LAP_UPDATES);
    expect(carLapsOf(f, 5)).toEqual([]);
    expect(carLapsOf(field([{lapS: 100}], 100), 0)).toEqual([]);
  });
});

describe('carLapsOf labels and gaps', () => {
  it('labels iRacing laps one above the counter, LMU laps by the counter', () => {
    const lmu = field([{lapS: 100, offsetM: 1000}], 3 * LAP_UPDATES);
    const ir = field([{lapS: 100, offsetM: 1000}], 3 * LAP_UPDATES, false);
    expect(lapLabelOffset(lmu)).toBe(0);
    expect(lapLabelOffset(ir)).toBe(1);
    expect(carLapsOf(ir, 0).map(l => l.lapNumber)).toEqual([3, 4]);
  });

  it('keeps a row, with no time, for a lap whose crossing was missed', () => {
    // Drop the update pair around the 2nd crossing (near update 987): that
    // lap and the next cannot be timed, but the counter shows both were driven.
    const f = field([{lapS: 100, offsetM: 100}], 5 * LAP_UPDATES);
    const car = f.cars[0];
    for (let u = 1480; u < 1495; u++) car.lapDistM[u] = 2000;
    const laps = carLapsOf(f, 0);
    const numbers = laps.map(l => l.lapNumber);
    expect(numbers).toEqual([2, 3, 4, 5]);
    expect(laps.some(l => l.timeS === null)).toBe(true);
    for (let i = 1; i < numbers.length; i++)
      expect((numbers[i] as number) - (numbers[i - 1] as number)).toBe(1);
  });

  // The player's laps in the 2 Oct Road Atlanta race (LMU), decimated around
  // the crossings: seven of its crossings read -0 to -1 m and used to drop
  // laps 3, 4, 10, 11, 18, 19, 21.
  it('lists every lap of a real LMU race, labels as the app has them', () => {
    const n = realLaps.timeS.length;
    const z = new Float32Array(n);
    const base = field([{lapS: 100}], 1);
    const car = {
      ...base.cars[0],
      lapDistM: Float32Array.from(realLaps.lapDistM),
      lapsDone: Int16Array.from(realLaps.lapsDone),
      inPits: Int8Array.from(realLaps.inPits),
      pathLateralM: z,
      xM: z,
      zM: z,
      place: new Int16Array(n),
      flag: new Int16Array(n),
    };
    const lmu: Field = {
      ...base,
      timeS: Float64Array.from(realLaps.timeS),
      cars: [car],
    };
    const laps = carLapsOf(lmu, 0);
    expect(laps.map(l => l.lapNumber)).toEqual(
      Array.from({length: 20}, (_, i) => i + 2),
    );
    const byLap = (n: number) => laps.find(l => l.lapNumber === n);
    expect(byLap(3)?.timeS).toBeCloseTo(81.53, 0);
    expect(byLap(4)?.timeS).toBeCloseTo(80.77, 0);
    expect(byLap(5)?.timeS).toBeCloseTo(80.49, 1);
    expect(laps.filter(l => l.timeS === null)).toHaveLength(0);
    // The same laps on iRacing's counter are labelled one up.
    const ir = carLapsOf({...lmu, hasPositions: false}, 0);
    expect(ir.map(l => l.lapNumber)).toEqual(
      Array.from({length: 20}, (_, i) => i + 3),
    );
  });
});
