import {describe, expect, it} from '@jest/globals';

import {
  formatCornerGap,
  formatDistance,
  formatLength,
  formatGap,
  formatLapTime,
  turnLabel,
  turnNumber,
} from './format';

describe('turn labels', () => {
  it('shows the app number, or the official label when there is one', () => {
    expect(turnLabel(8)).toBe('T8');
    expect(turnLabel(9, 'T10a')).toBe('T10a');
    expect(turnLabel(7, 'T7 entry')).toBe('T7 entry');
  });

  it('badges take only the number part: "10a", and "7" for "T7 entry"', () => {
    expect(turnNumber(8)).toBe('8');
    expect(turnNumber(9, 'T10a')).toBe('10a');
    expect(turnNumber(7, 'T7 entry')).toBe('7');
  });
});

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
