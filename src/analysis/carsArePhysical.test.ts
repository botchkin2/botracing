import {describe, expect, it} from '@jest/globals';

import {carsArePhysical} from './carsArePhysical';

describe('carsArePhysical', () => {
  it('a race and a practice have the other cars on track', () => {
    expect(carsArePhysical('Race')).toBe(true);
    expect(carsArePhysical('R')).toBe(true);
    expect(carsArePhysical('Practice')).toBe(true);
    expect(carsArePhysical('P')).toBe(true);
  });

  it('a qualifying does not, as the doc and the app spell it', () => {
    expect(carsArePhysical('Qualify')).toBe(false);
    expect(carsArePhysical('Q')).toBe(false);
    expect(carsArePhysical('qualifying')).toBe(false);
  });
});
