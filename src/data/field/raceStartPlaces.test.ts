import {describe, expect, it} from '@jest/globals';

import {carsAt, prepareRace} from '@/src/analysis/raceState';

import startSlice from './__fixtures__/sebringOct21Start.field.json';
import {toField} from './adapters';

// A real slice (65 updates, 9 cars) of the stored field of the Sebring race of Oct 21 (session 53128f6f), cut around
// the green flag at update 287 of the file (pit-wall thread 109, ticket 54). The game's own place reads wrong for the
// updates in which a car crosses the start line (lap still 0, distance wrapped): the LMP2 pole car read P9 at +3 m and
// +10 m, and the cars behind it each read one place up.
describe('the places on screen at the Sebring green flag', () => {
  const field = toField(startSlice);
  const prep = prepareRace(field);
  const ticks = Array.from({length: field.timeS.length}, (_, u) => u);

  /** How many times a car's value changes and comes back within `within` updates. */
  const blips = (series: number[], within: number) => {
    let n = 0;
    for (let u = 1; u < series.length; u++) {
      if (series[u] === series[u - 1]) continue;
      for (let k = u + 1; k < series.length && k <= u + within; k++)
        if (series[k] === series[u - 1]) {
          n++;
          break;
        }
    }
    return n;
  };

  it('the slice shows the game blipping (otherwise this test proves nothing)', () => {
    const raw = field.cars.reduce((sum, c) => sum + blips(Array.from(c.place), 3), 0);
    expect(raw).toBeGreaterThan(4);
  });

  it('no car\'s class place flips and comes back within 0.6 s', () => {
    const at = ticks.map(u => carsAt(prep, field.timeS[u], true));
    for (const c of field.cars) {
      const classPlaces = at.map(cars => cars.find(x => x.index === c.index)?.classPlace ?? 0);
      expect(blips(classPlaces, 3)).toBe(0);
    }
  });

  it('the printed place is steadied too, and the field\'s own place is untouched', () => {
    const rawBefore = field.cars.map(c => Array.from(c.place));
    const at = ticks.map(u => carsAt(prep, field.timeS[u], true));
    for (const c of field.cars) {
      const printed = at.map(cars => cars.find(x => x.index === c.index)?.place ?? 0);
      expect(blips(printed, 3)).toBe(0);
    }
    expect(field.cars.map(c => Array.from(c.place))).toEqual(rawBefore);
    expect(field.cars.some(c => blips(Array.from(c.place), 3) > 0)).toBe(true);
  });

  it('the pole car is first in its class at every update, as the grid says', () => {
    const lmp2 = field.cars.find(c => c.carClass.startsWith('LMP2') && c.place[0] === 1);
    expect(lmp2).toBeDefined();
    for (const u of ticks) {
      const car = carsAt(prep, field.timeS[u], true).find(x => x.index === lmp2!.index);
      expect(car?.classPlace).toBe(1);
    }
  });
});
