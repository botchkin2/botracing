import {describe, expect, it} from '@jest/globals';

import {
  emptyWindowText,
  STATS_WINDOW_DAYS,
  statsSinceLabel,
  statsWindowStart,
  withinStatsWindow,
} from './statsWindow';

// A frozen clock: noon UTC, 29 Oct 2026. 183 days earlier is 29 Apr 2026.
const NOW = new Date('2026-10-29T12:00:00Z');
const at = (iso: string) => ({id: iso, startedAt: iso});

describe('the stats window', () => {
  it('is 183 days back from now', () => {
    expect(STATS_WINDOW_DAYS).toBe(183);
    expect(statsWindowStart(NOW).toISOString()).toBe(
      '2026-04-29T12:00:00.000Z',
    );
  });

  it('keeps a session inside the window and drops one outside, edge included', () => {
    const rows = [
      at('2026-10-28T09:00:00Z'),
      at('2026-04-29T12:00:00Z'),
      at('2026-04-29T11:59:59Z'),
      at('2026-03-10T09:00:00Z'),
    ];
    expect(withinStatsWindow(rows, NOW).map(r => r.id)).toEqual([
      '2026-10-28T09:00:00Z',
      '2026-04-29T12:00:00Z',
    ]);
  });

  it('keeps the order and the rows themselves', () => {
    const rows = [at('2026-09-01T00:00:00Z'), at('2026-10-01T00:00:00Z')];
    const kept = withinStatsWindow(rows, NOW);
    expect(kept[0]).toBe(rows[0]);
    expect(kept[1]).toBe(rows[1]);
  });

  it('keeps a session whose start cannot be read, and returns [] for none', () => {
    expect(withinStatsWindow([at('not a date')], NOW)).toHaveLength(1);
    expect(withinStatsWindow([], NOW)).toEqual([]);
  });

  it('moves with the clock', () => {
    const rows = [at('2026-05-10T00:00:00Z')];
    expect(withinStatsWindow(rows, NOW)).toHaveLength(1);
    const later = new Date('2026-12-01T12:00:00Z');
    expect(withinStatsWindow(rows, later)).toHaveLength(0);
  });

  it('labels its blocks with the date it starts', () => {
    expect(statsSinceLabel(NOW)).toMatch(/^since Apr 2[89]$/);
    expect(emptyWindowText(NOW)).toMatch(
      /^Nothing since Apr 2[89]\. Older sessions are in the list$/,
    );
  });
});
