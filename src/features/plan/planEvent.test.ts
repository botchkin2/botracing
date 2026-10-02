import {describe, expect, it} from '@jest/globals';

import type {SessionSummary} from '@/src/data/sessions';

import {eventLabel, eventsOf, seriesWeek} from './planEvent';

// Local times, so the test holds in any time zone.
const at = (m: number, d: number, h: number, min = 0) =>
  new Date(2026, m - 1, d, h, min).toISOString();

describe('seriesWeek', () => {
  it('turns over on Tuesday 18:00 local', () => {
    // 2026-09-29 is a Tuesday.
    expect(seriesWeek(at(9, 29, 17, 59))).toBe('2026-09-22');
    expect(seriesWeek(at(9, 29, 18, 0))).toBe('2026-09-29');
    expect(seriesWeek(at(9, 29, 23, 59))).toBe('2026-09-29');
  });

  it('holds the whole week, Wednesday to the next Tuesday afternoon', () => {
    expect(seriesWeek(at(9, 30, 3))).toBe('2026-09-29');
    expect(seriesWeek(at(10, 2, 0, 12))).toBe('2026-09-29');
    expect(seriesWeek(at(10, 6, 17))).toBe('2026-09-29');
    expect(seriesWeek(at(10, 6, 19))).toBe('2026-10-06');
  });

  it('crosses a month and a year', () => {
    expect(seriesWeek(at(1, 2, 12))).toBe('2025-12-30');
  });
});

describe('eventsOf', () => {
  const s = (id: string, startedAt: string, series: string | null = null) =>
    ({id, startedAt, series} as SessionSummary);

  it('groups a track and car into series weeks, newest first, and keeps a name when any session has one', () => {
    const events = eventsOf([
      s('race', at(10, 2, 0, 12)),
      s('quali', at(10, 1, 23, 59), 'One Stint Sprint'),
      s('old', at(9, 25, 0, 38), 'ELMS Super 60'),
      s('old2', at(9, 24, 23, 32)),
    ]);
    expect(events).toEqual([
      {
        week: '2026-09-29',
        sessionIds: ['race', 'quali'],
        series: 'One Stint Sprint',
      },
      {
        week: '2026-09-22',
        sessionIds: ['old', 'old2'],
        series: 'ELMS Super 60',
      },
    ]);
  });
});

describe('eventLabel', () => {
  it('names the series only when known', () => {
    const e = {week: '2026-09-29', sessionIds: [], series: 'One Stint Sprint'};
    expect(eventLabel(e, 100)).toBe('One Stint Sprint · week of 09-29 · 100 L');
    expect(eventLabel({...e, series: null}, 75)).toBe('week of 09-29 · 75 L');
    expect(eventLabel({...e, series: null}, null)).toBe('week of 09-29');
  });
});
