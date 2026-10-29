import {formatDayMonth} from '@/src/design/format';

// The one window every read across sessions looks back over (ticket 79; his
// words: "data older than like 6 months is no longer valid", the game changes).
// Track Best by car and the trend, Progression, and the Plan's class pace read
// it; the session list, Tracks and the Plan's own history (PLAN_HISTORY_DAYS)
// stay all-time, so an older session still opens. Pure: the clock comes in.

/** About six months: 183 days. */
export const STATS_WINDOW_DAYS = 183;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The first instant inside the window. */
export function statsWindowStart(now: Date): Date {
  return new Date(now.getTime() - STATS_WINDOW_DAYS * DAY_MS);
}

/** The sessions that started inside the window, in their order. An unreadable `startedAt` is kept: no data is not old data. */
export function withinStatsWindow<T extends {startedAt: string}>(
  rows: readonly T[],
  now: Date,
): T[] {
  const from = statsWindowStart(now).getTime();
  return rows.filter(r => {
    const at = new Date(r.startedAt).getTime();
    return Number.isNaN(at) || at >= from;
  });
}

/** "since Apr 29": the label of a block that reads the window. It moves daily. */
export function statsSinceLabel(now: Date): string {
  return `since ${formatDayMonth(statsWindowStart(now).toISOString())}`;
}

/** Said in place of a block that has sessions, none of them inside the window. */
export function emptyWindowText(now: Date): string {
  const since = formatDayMonth(statsWindowStart(now).toISOString());
  return `Nothing since ${since}. Older sessions are in the list`;
}
