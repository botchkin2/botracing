import {describe, expect, it} from '@jest/globals';

import {fillLimitWithinTank} from './fuelLimits';

describe('fillLimitWithinTank', () => {
  it('leaves out a fill limit above the tank', () => {
    expect(fillLimitWithinTank(1980, 105)).toBeNull();
    expect(fillLimitWithinTank(105.6, 105)).toBeNull();
  });

  it("keeps one at or under the tank, with the Plan's 0.5 L of slack", () => {
    expect(fillLimitWithinTank(84, 115)).toBe(84);
    expect(fillLimitWithinTank(105, 105)).toBe(105);
    expect(fillLimitWithinTank(105.5, 105)).toBe(105.5);
  });

  it('keeps it when the tank is not known, and null stays null', () => {
    expect(fillLimitWithinTank(1980, null)).toBe(1980);
    expect(fillLimitWithinTank(null, 105)).toBeNull();
    expect(fillLimitWithinTank(null, null)).toBeNull();
  });
});
