import {describe, expect, it} from '@jest/globals';

import {type SessionClassBests} from '@/src/data/sessions';

import {classTable} from './classTable';

const base: SessionClassBests = {
  version: 1,
  kind: 'race',
  vehicles: ['BMW M4 LMGT3', 'Porsche 911 GT3 R LMGT3', 'Cadillac V-Series.R'],
  classes: {
    hypercar: {
      bestsS: [80, 81, 82],
      vehicleAt: [2, 2, -1],
      player: null,
    },
    gt3: {
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
        lmp2: {bestsS: [88, 89], vehicleAt: [-1, -1], player: null},
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

  it('names cars the way the rest of the app does, without the class the row already sits under, and leaves an unnamed one blank', () => {
    const e = t.rows[0].entries;
    expect(e[0].car).toBe('BMW M4');
    // 'GT3 R' is the model, not the class: only LMU's class token goes.
    expect(e.map(x => x.car)).toContain('Porsche 911 GT3 R');
    const lmh = classTable({
      ...base,
      vehicles: ['Aston Martin Valkyrie LMH'],
      classes: {
        hypercar: {bestsS: [80, 81], vehicleAt: [0, 0], player: null},
      },
    })!;
    expect(lmh.rows[0].entries[0].car).toBe('Aston Martin Valkyrie');
    expect(e[5].car).toBeNull();
  });

  it("shows the player's own lap as the official one wherever it appears: the You row, the unfolded entry, and a Best or 5th cell that is that lap", () => {
    // The field's clock reads the player's 5th-fastest lap 1 ms away from the official best.
    const t2 = classTable(base, 99.501)!;
    const gt3 = t2.rows[0];
    expect(gt3.mine).toEqual({bestS: 99.501, rank: 4});
    expect(gt3.entries[3]).toMatchObject({player: true, bestS: 99.501});
    expect(gt3.entries[3].gapS).toBeCloseTo(1.501, 6);
    // Other cars stay on the field clock.
    expect(gt3.entries[2].bestS).toBe(99);
    // The player is 4th of 6 here; as 5th the fifth cell is the official lap too.
    const fifth = classTable(
      {
        ...base,
        classes: {
          gt3: {...base.classes.gt3!, player: 4},
        },
      },
      100.001,
    )!;
    expect(fifth.rows[0].fifthS).toBe(100.001);
    expect(fifth.rows[0].mine?.bestS).toBe(100.001);
  });

  it('is null with nothing to compare against: no block, or one car in the whole field', () => {
    expect(classTable(null)).toBeNull();
    expect(
      classTable({
        ...base,
        classes: {gt3: {bestsS: [99], vehicleAt: [-1], player: 0}},
      }),
    ).toBeNull();
  });
});
