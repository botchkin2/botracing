import {describe, expect, it} from '@jest/globals';

import {carLapsOf} from './carLaps';
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

function field(specs: Spec[], updates: number): Field {
  return {
    version: 2,
    hz: 5,
    hasPositions: false,
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
