import {describe, expect, it} from '@jest/globals';

import {ABSENT, type Field, type FieldCar} from './field';
import {finishPosition, finishUpdateOf, type ResultField} from './raceResult';
import {carsAt, prepareRace} from './raceState';

// The Race screen opens a race at his last line crossing; the list there must say what the
// Session head's Result says. The same six updates as raceResult.test.ts: the player (GT3)
// crosses the line at updates 1, 2 and 3 and takes 2nd overall, 1st in class at the last;
// he is scored 4th overall after he drives off (updates 4 and 5), which must not be read.
const HZ = 5;
const encoded: ResultField = {
  cars: [
    {class: 'GT3', player: true},
    {class: 'Hyper'},
    {class: 'GT3'},
    {class: 'GT3'},
  ],
  place: [
    [3, 3, 3, 2, 4, 4],
    [1, 1, 1, 1, 1, 1],
    [2, 2, 2, 3, 2, 2],
    [4, 4, 4, 4, null, null],
  ],
  laps: [
    [0, 1, 2, 3, 3, 3],
    [0, 1, 2, 3, 3, 3],
    [0, 1, 2, 2, 3, 3],
    [0, 1, 2, 2, null, null],
  ],
};

function decoded(f: ResultField): Field {
  const n = f.place[0].length;
  const cars: FieldCar[] = f.cars.map((c, i) => {
    const car: FieldCar = {
      index: i,
      carClass: c.class,
      classId: null,
      classLabel: null,
      vehicle: null,
      player: c.player === true,
      lapDistM: new Float32Array(n),
      pathLateralM: new Float32Array(n),
      xM: new Float32Array(n),
      zM: new Float32Array(n),
      yawRad: new Float32Array(n),
      place: new Int16Array(n),
      lapsDone: new Int16Array(n),
      inPits: new Int8Array(n),
      flag: new Int16Array(n),
    };
    for (let u = 0; u < n; u++) {
      const place = f.place[i][u];
      const laps = f.laps[i][u];
      if (place == null || laps == null) {
        car.lapDistM[u] = NaN;
        car.xM[u] = NaN;
        car.zM[u] = NaN;
        car.yawRad![u] = NaN;
        car.place[u] = ABSENT;
        car.lapsDone[u] = ABSENT;
        car.inPits[u] = ABSENT;
        continue;
      }
      // Every car keeps moving along a 1000 m lap.
      car.lapDistM[u] = (u * 220 + i * 7) % 1000;
      car.xM[u] = u * 220 + i * 7;
      car.place[u] = place;
      car.lapsDone[u] = laps;
    }
    return car;
  });
  return {
    version: 2,
    hz: HZ,
    hasPositions: true,
    startEtS: 0,
    timeS: Float64Array.from({length: n}, (_, u) => u / HZ),
    cars,
  };
}

describe('the Race screen opens at his finish', () => {
  const field = decoded(encoded);

  it('at his last line crossing, not where he was scored after leaving the track', () => {
    expect(finishUpdateOf(field)).toBe(3);
  });

  it('says nothing without a player, or where the field has no place for him then', () => {
    const noPlayer = {
      ...field,
      cars: field.cars.map(c => ({...c, player: false})),
    };
    expect(finishUpdateOf(noPlayer)).toBeNull();
  });

  it("lists him where the head's Result says: the same overall and class place", () => {
    const u = finishUpdateOf(field)!;
    const me = carsAt(prepareRace(field), field.timeS[u], true).find(
      c => c.player,
    )!;
    const result = finishPosition(encoded)!;
    expect([me.place, me.classPlace]).toEqual([result.overall, result.inClass]);
  });
});
