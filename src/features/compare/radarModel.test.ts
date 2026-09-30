import {describe, expect, it} from '@jest/globals';

import {type Field, type FieldCar} from '@/src/analysis/field';

import {raceClock} from '@/src/analysis/raceClock';

import {radarAtCursor, radarHasCars, raceClockLabel} from './radarModel';

// A player driving north at 50 m/s, 5 Hz, from 0 m; one car 10 m ahead and
// 3 m right, all on lap 2 (the game's laps-completed count).
function build(): Field {
  const n = 60;
  const arr = (f: (i: number) => number) =>
    Float32Array.from({length: n}, (_, i) => f(i));
  const car = (index: number, player: boolean, dz: number, dx: number) =>
    ({
      index,
      carClass: 'GT3',
      vehicle: null,
      player,
      lapDistM: arr(i => 100 + i * 10),
      pathLateralM: arr(() => 0),
      xM: arr(() => dx),
      zM: arr(i => i * 10 + dz),
      yawRad: arr(() => 0),
      place: Int16Array.from({length: n}, () => index + 1),
      lapsDone: Int16Array.from({length: n}, () => 2),
      inPits: Int8Array.from({length: n}, () => 0),
      flag: Int16Array.from({length: n}, () => 0),
    } satisfies FieldCar);
  return {
    version: 2,
    hz: 5,
    startEtS: 0,
    timeS: Float64Array.from({length: n}, (_, i) => i * 0.2),
    cars: [car(0, true, 0, 0), car(1, false, 10, 3)],
  };
}

describe('radarAtCursor', () => {
  const f = build();
  const clock = raceClock(f);

  it('finds the sample at the cursor and the car ahead and to the right', () => {
    const v = radarAtCursor(f, clock, 2, 300, 98, 148)!;
    expect(v.sampleLabel).toBe('0:04.0');
    expect(v.radar!.cars).toHaveLength(1);
    expect(v.radar!.cars[0].forwardM).toBeCloseTo(10);
    expect(v.radar!.cars[0].sideM).toBeCloseTo(3);
  });

  it('snaps to the 5 Hz sample at or before the moment, not the nearest', () => {
    // 309 m on lap 2 is 4.18 s: the sample at 4.0 s, not the one at 4.2 s.
    expect(radarAtCursor(f, clock, 2, 309, 98, 148)!.sampleLabel).toBe(
      '0:04.0',
    );
  });

  it('is null for a lap the field does not cover', () => {
    expect(radarAtCursor(f, clock, 5, 300, 98, 148)).toBeNull();
    expect(radarAtCursor(f, clock, 2, 9000, 98, 148)).toBeNull();
  });
});

describe('radarHasCars', () => {
  const clock = raceClock(build());

  it('is true with a car in range', () => {
    const v = radarAtCursor(build(), clock, 2, 300, 72, 108);
    expect(radarHasCars(v)).toBe(true);
  });

  it('is false with nobody in range, and where the field does not cover the lap', () => {
    // The same field with the other car 500 m ahead: out of the 30 m range.
    const far = build();
    far.cars[1].zM = far.cars[1].zM.map(z => z + 500);
    expect(
      radarHasCars(radarAtCursor(far, raceClock(far), 2, 300, 72, 108)),
    ).toBe(false);
    expect(radarHasCars(radarAtCursor(build(), clock, 5, 300, 72, 108))).toBe(
      false,
    );
    expect(radarHasCars(null)).toBe(false);
  });
});

describe('raceClockLabel', () => {
  it('reads m:ss.s', () => {
    expect(raceClockLabel(0)).toBe('0:00.0');
    expect(raceClockLabel(1283.4)).toBe('21:23.4');
    expect(raceClockLabel(59.99)).toBe('0:59.9');
  });
});
