import {describe, expect, it} from '@jest/globals';

import {
  formatCornerGap,
  dayMonthOf,
  formatDay,
  formatDate,
  formatDayMonth,
  formatDayMonthTime,
  formatDistance,
  formatLength,
  formatGap,
  formatLapTime,
  formatRaceGap,
  oneDecimal,
  turnLabel,
} from './format';

describe('turn labels', () => {
  it('shows the app number, or the official label when there is one', () => {
    expect(turnLabel(8)).toBe('T8');
    expect(turnLabel(9, 'T10a')).toBe('T10a');
    expect(turnLabel(7, 'T7 entry')).toBe('T7 entry');
  });

  it('badges take only the number part: "10a", and "7" for "T7 entry"', () => {});
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
    expect(formatGap(0.0004)).toBe('±0.000');
    expect(formatGap(-0.0004)).toBe('±0.000');
    expect(formatGap(0.0006)).toBe('+0.001');
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

describe('oneDecimal', () => {
  it('rounds half up on the stored value, not on the float below it', () => {
    expect(oneDecimal(2.55)).toBe('2.6');
    expect(oneDecimal(2.45)).toBe('2.5');
    expect(oneDecimal(2.449)).toBe('2.4');
    expect(oneDecimal(2.5)).toBe('2.5');
  });
});

describe('formatRaceGap', () => {
  it('gives seconds under a minute and m:ss.s from a minute', () => {
    expect(formatRaceGap(3.412)).toBe('+3.412');
    expect(formatRaceGap(0)).toBe('+0.000');
    expect(formatRaceGap(59.9994)).toBe('+59.999');
    expect(formatRaceGap(64.2)).toBe('+1:04.2');
    expect(formatRaceGap(600)).toBe('+10:00.0');
    // Rounding carries into the minutes, never "+1:60.0" or "+60.000".
    expect(formatRaceGap(119.97)).toBe('+2:00.0');
    expect(formatRaceGap(59.9996)).toBe('+1:00.0');
    expect(formatRaceGap(3599.97)).toBe('+60:00.0');
  });
});

describe('formatDayMonth', () => {
  it('is the short month and the day, US order', () => {
    expect(formatDayMonth(new Date(2026, 8, 14, 12).toISOString())).toBe(
      'Sep 14',
    );
    expect(formatDayMonth(new Date(2026, 9, 9, 12).toISOString())).toBe(
      'Oct 9',
    );
  });

  it('is empty for a bad date', () => {
    expect(formatDayMonth('not a date')).toBe('');
  });

  it('spells September "Sep", as the one short-date formatter, and the long form agrees', () => {
    const d = new Date(2026, 8, 5, 12);
    expect(dayMonthOf(d)).toBe('Sep 5');
    expect(formatDate(d.toISOString())).toBe('Sep 5, 2026');
  });

  it('gives the day, not a leading zero, after the month', () => {
    const d = new Date(2026, 9, 9, 12).toISOString();
    expect(formatDay(d)).toBe('Oct 9');
    expect(formatDate(d)).toBe('Oct 9, 2026');
  });
});

describe('formatDayMonthTime', () => {
  const now = new Date(2026, 8, 30, 12, 0);

  it('adds the local time within the current year', () => {
    expect(
      formatDayMonthTime(new Date(2026, 8, 14, 18, 5).toISOString(), now),
    ).toBe('Sep 14, 18:05');
  });

  it('adds the year for an earlier year', () => {
    expect(
      formatDayMonthTime(new Date(2025, 8, 14, 18, 5).toISOString(), now),
    ).toBe('Sep 14, 2025');
  });

  it('is empty for a bad date', () => {
    expect(formatDayMonthTime('nope', now)).toBe('');
  });
});
