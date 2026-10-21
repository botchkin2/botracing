import {describe, expect, it} from '@jest/globals';

import {formationBurnOf, formationText} from './formation';

// Each race's burn is the fuel its first lap used (`plan.race.formationL`, set
// by the uploader), or null where the race has none.
describe('formationBurnOf', () => {
  it('measures the median formation burn against one green lap, from two races', () => {
    // The two accuracy-review races: first laps of 3.27 and 3.54 L less their
    // 2.43 and 2.45 L green medians (the L1 inside them), as planBlock.mjs stores.
    const b = formationBurnOf([0.84, 1.09], 2.43);
    expect(b.kind).toBe('measured');
    expect(b.races).toBe(2);
    expect(b.burnL).toBeCloseTo(0.965);
    expect(b.factor.fuel).toBeCloseTo(0.965 / 2.43);
    // VE does not move before the green (Silverstone, Sebring).
    expect(b.factor.ve).toBe(0);
  });

  it('estimates 0.4 laps of fuel under two races, and says so', () => {
    const b = formationBurnOf([0.9], 2.43);
    expect(b).toMatchObject({kind: 'estimate', races: 0, burnL: null});
    expect(b.factor).toEqual({fuel: 0.4, ve: 0});
    expect(formationText(b)).toBe('0.4 laps of fuel · estimate');
  });

  it('estimates with no green median to compare with, or no first-lap fuel', () => {
    expect(formationBurnOf([3.3, 3.4], null).kind).toBe('estimate');
    expect(formationBurnOf([null, null], 2.4).kind).toBe('estimate');
    expect(formationBurnOf([3.3, 0], 2.4).kind).toBe('estimate');
  });

  it('names the measured burn with the races behind it', () => {
    expect(formationText(formationBurnOf([0.84, 1.09], 2.43))).toBe(
      '1.0 L · 2 races',
    );
  });
});
