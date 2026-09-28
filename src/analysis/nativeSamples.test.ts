import {describe, expect, it} from '@jest/globals';

import {nearestSample, sliceSamples, thinSamples} from './nativeSamples';

const s = {
  distanceM: [0, 1.4, 2.8, 4.2, 5.6, 7.0],
  values: [0, 10, 40, 80, 85, 90],
};

describe('sliceSamples', () => {
  it('keeps the window and one sample either side', () => {
    expect(sliceSamples(s, 2, 5).distanceM).toEqual([1.4, 2.8, 4.2, 5.6]);
  });
  it('clamps at the ends', () => {
    expect(sliceSamples(s, -10, 1).distanceM).toEqual([0, 1.4]);
    expect(sliceSamples(s, 6, 99).distanceM).toEqual([5.6, 7.0]);
  });
});

describe('nearestSample', () => {
  it('returns a recorded value, never a blend', () => {
    expect(nearestSample(s, 2.0)).toBe(10);
    expect(nearestSample(s, 2.2)).toBe(40);
    expect(nearestSample(s, -5)).toBe(0);
    expect(nearestSample(s, 50)).toBe(90);
  });
  it('is null with no samples', () => {
    expect(nearestSample({distanceM: [], values: []}, 3)).toBeNull();
  });
});

describe('thinSamples', () => {
  it('keeps first, min and max per bucket, all real samples', () => {
    const t = thinSamples(
      {distanceM: [0, 1, 2, 3, 10, 11], values: [5, 1, 9, 4, 3, 3]},
      5,
    );
    expect(t.distanceM).toEqual([0, 1, 2, 10]);
    expect(t.values).toEqual([5, 1, 9, 3]);
  });
});
