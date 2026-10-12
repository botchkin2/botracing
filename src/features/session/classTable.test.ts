import {describe, expect, it} from '@jest/globals';

import {type SessionClassBests} from '@/src/data/sessions';

import {classTable} from './classTable';

const base: SessionClassBests = {
  version: 1,
  kind: 'race',
  vehicles: ['BMW M4 LMGT3', 'Porsche 911 GT3 R LMGT3', 'Cadillac V-Series.R'],
  classes: {
    hypercar: {
      cars: 3,
      bestsS: [80, 81, 82],
      vehicleAt: [2, 2, -1],
      player: null,
    },
    gt3: {
      cars: 6,
      bestsS: [98, 98.5, 99, 99.5, 100, 101],
      vehicleAt: [0, 0, 1, 0, 1, -1],
      player: 3,
    },
  },
};

describe('classTable', () => {
  const t = classTable(base)!;

  it("puts the player's class first, then the others by pace", () => {
    expect(t.rows.map(r => r.key)).toEqual(['gt3', 'hypercar']);
    const lmp2 = classTable({
      ...base,
      classes: {
        ...base.classes,
        lmp2: {cars: 2, bestsS: [88, 89], vehicleAt: [-1, -1], player: null},
      },
    })!;
    expect(lmp2.rows.map(r => r.key)).toEqual(['gt3', 'hypercar', 'lmp2']);
  });

  it('is best, fifth-fastest and car count per class, the last car when fewer than five', () => {
    const gt3 = t.rows[0];
    expect([gt3.label, gt3.bestS, gt3.fifthS, gt3.cars]).toEqual([
      'GT3',
      98,
      100,
      6,
    ]);
    const hyper = t.rows[1];
    expect([hyper.bestS, hyper.fifthS, hyper.cars]).toEqual([80, 82, 3]);
  });

  it("gives the player's own best and place in their row only", () => {
    expect(t.rows[0].mine).toEqual({bestS: 99.5, rank: 4});
    expect(t.rows[1].mine).toBeNull();
  });

  it('unfolds to every car with its rank, model, best and gap to the class best, the player marked', () => {
    const e = t.rows[0].entries;
    expect(e).toHaveLength(6);
    expect(e[0]).toMatchObject({rank: 1, bestS: 98, gapS: 0, player: false});
    expect(e[3]).toMatchObject({rank: 4, bestS: 99.5, player: true});
    expect(e[3].gapS).toBeCloseTo(1.5, 6);
    expect(e.filter(x => x.player)).toHaveLength(1);
  });

  it('names cars the way the rest of the app does, and leaves an unnamed one blank', () => {
    const e = t.rows[0].entries;
    expect(e[0].car).toBe('BMW M4 LMGT3');
    expect(e[5].car).toBeNull();
  });

  it('is null with nothing to compare against: no block, or one car in the whole field', () => {
    expect(classTable(null)).toBeNull();
    expect(
      classTable({
        ...base,
        classes: {gt3: {cars: 1, bestsS: [99], vehicleAt: [-1], player: 0}},
      }),
    ).toBeNull();
  });
});
