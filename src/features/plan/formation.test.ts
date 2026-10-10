import {describe, expect, it} from '@jest/globals';

import {formationBurnOf, formationText} from './formation';

// Each race's burn is the fuel its first lap used (`plan.race.formationL`, set
// by the uploader), or null where the race has none.
describe('formationBurnOf', () => {
  it('measures the median first-lap burn against one green lap, from two races', () => {
    // The two accuracy-review fixtures: 3.27 and 3.54 L, a 2.43 L green lap.
    const b = formationBurnOf([3.27, 3.54], 2.43);
    expect(b.kind).toBe('measured');
    expect(b.races).toBe(2);
    expect(b.burnL).toBeCloseTo(3.405);
    expect(b.factor.fuel).toBeCloseTo(3.405 / 2.43);
    expect(b.factor.ve).toBe(1);
  });

  it('estimates 1.4 laps of fuel under two races, and says so', () => {
    const b = formationBurnOf([3.3], 2.43);
    expect(b).toMatchObject({kind: 'estimate', races: 0, burnL: null});
    expect(b.factor).toEqual({fuel: 1.4, ve: 1});
    expect(formationText(b)).toBe('1.4 laps of fuel · estimate');
  });

  it('estimates with no green median to compare with, or no first-lap fuel', () => {
    expect(formationBurnOf([3.3, 3.4], null).kind).toBe('estimate');
    expect(formationBurnOf([null, null], 2.4).kind).toBe('estimate');
    expect(formationBurnOf([3.3, 0], 2.4).kind).toBe('estimate');
  });

  it('names the measured burn with the races behind it', () => {
    expect(formationText(formationBurnOf([3.27, 3.54], 2.43))).toBe(
      '3.4 L · 2 races',
    );
  });
});
