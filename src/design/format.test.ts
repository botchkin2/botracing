import {describe, expect, it} from '@jest/globals';

import {
  formatCornerGap,
  formatDistance,
  formatLength,
  formatGap,
  formatLapTime,
} from './format';

describe('format', () => {
  it('lap time m:ss.sss', () => {
    expect(formatLapTime(99.733)).toBe('1:39.733');
    expect(formatLapTime(126.2134)).toBe('2:06.213');
    expect(formatLapTime(59.9996)).toBe('1:00.000');
  });
  it('signed gaps', () => {
    expect(formatGap(0.312)).toBe('+0.312');
    expect(formatGap(-0.105)).toBe('−0.105');
    expect(formatCornerGap(0.214)).toBe('+.21');
    expect(formatCornerGap(-1.04)).toBe('−1.04');
  });
  it('distance', () => {
    expect(formatDistance(2150.4)).toBe('2,150 m');
  });
});

describe('formatLength', () => {
  it('gives km and miles to the metre', () => {
    expect(formatLength(5891)).toEqual({km: '5.891 km', mi: '3.660 mi'});
  });
});
