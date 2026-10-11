import {describe, expect, it} from '@jest/globals';

import {overviewScale} from './overviewScale';

describe('overviewScale', () => {
  it('is symmetric, rounded out to a 1-2-5 step, labelled in seconds at its ends', () => {
    const s = overviewScale([{values: [0, 0.3, -0.42]}, {values: [0.1]}]);
    expect(s.domain).toEqual([-0.5, 0.5]);
    expect(s.ticks.map(t => t.label)).toEqual(['−0.5 s', '+0.5 s']);
  });

  it('covers the largest gap of any lap', () => {
    const s = overviewScale([{values: [0.2]}, {values: [-3.4]}]);
    expect(s.domain[1]).toBeGreaterThanOrEqual(3.4);
    expect(s.domain[0]).toBe(-s.domain[1]);
  });

  it('has a unit range with no finite values', () => {
    const s = overviewScale([{values: [NaN]}]);
    expect(s.domain).toEqual([-1, 1]);
    expect(s.ticks.map(t => t.label)).toEqual(['−1 s', '+1 s']);
  });
});
