import {describe, expect, it} from '@jest/globals';

import {toLaps} from '@/src/data/sessions/adapters';

import {formationBurnOf, formationText} from './formation';

// A race: its first (formation) lap burnt `first` litres, then green laps.
const race = (first: number, id = 'r') =>
  toLaps(
    [first, 2.4, 2.4].map((usedL, i) => ({
      id: `${id}-${i}`,
      lapIndex: i + 1,
      lapTime: 100,
      stint: 1,
      comparable: true,
      reasons: [],
      fuel: {usedL, green: i > 0},
    })),
  );

describe('formationBurnOf', () => {
  it('measures the median first-lap burn against one green lap, from two races', () => {
    // The two accuracy-review fixtures: 3.27 and 3.54 L, a 2.43 L green lap.
    const b = formationBurnOf([race(3.27, 'a'), race(3.54, 'b')], 2.43);
    expect(b.kind).toBe('measured');
    expect(b.races).toBe(2);
    expect(b.burnL).toBeCloseTo(3.405);
    expect(b.factor.fuel).toBeCloseTo(3.405 / 2.43);
    expect(b.factor.ve).toBe(1);
  });

  it('estimates 1.4 laps of fuel under two races, and says so', () => {
    const b = formationBurnOf([race(3.3)], 2.43);
    expect(b).toMatchObject({kind: 'estimate', races: 0, burnL: null});
    expect(b.factor).toEqual({fuel: 1.4, ve: 1});
    expect(formationText(b)).toBe('1.4 laps of fuel · estimate');
  });

  it('estimates with no green median to compare with, or no first-lap fuel', () => {
    expect(formationBurnOf([race(3.3), race(3.4)], null).kind).toBe('estimate');
    const noFuel = toLaps([
      {id: 'x', lapIndex: 1, lapTime: 100, stint: 1, reasons: []},
    ]);
    expect(formationBurnOf([noFuel, noFuel], 2.4).kind).toBe('estimate');
  });

  it('names the measured burn with the races behind it', () => {
    expect(
      formationText(formationBurnOf([race(3.27, 'a'), race(3.54, 'b')], 2.43)),
    ).toBe('3.4 L · 2 races');
  });
});
