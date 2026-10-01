import {type SessionSummary} from '@/src/data/sessions';
import {carLabel, formatDayMonthTime, formatLapTime} from '@/src/design';

export type SwitcherRow = {
  id: string;
  /** R, Q or P. */
  badge: string;
  /** "14 Sep, 18:30", or "14 Sep 2025" from an earlier year */
  date: string;
  /** "Porsche 911 GT3 R · Manthey #91" */
  car: string;
  /** The session's best lap, or null with none. */
  best: string | null;
  open: boolean;
};

/**
 * The other sessions at the open session's track, newest first (round 6: the
 * ▾ switches to another session at the same track). Sessions with no laps
 * are left out; the open one stays in the list, marked, so the menu shows
 * where you are among them. At most SWITCHER_MAX_ROWS rows, the open one
 * always kept.
 */
export const SWITCHER_MAX_ROWS = 12;

export function switcherRows(
  items: SessionSummary[],
  trackId: string,
  openId: string,
): SwitcherRow[] {
  return items
    .filter(s => s.trackId === trackId && (s.lapCount > 0 || s.id === openId))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .filter((s, i) => i < SWITCHER_MAX_ROWS || s.id === openId)
    .map(s => {
      const car = carLabel(s.car);
      return {
        id: s.id,
        badge: s.sessionType,
        date: formatDayMonthTime(s.startedAt),
        car: [car.model, car.entry].filter(Boolean).join(' · '),
        best: s.bestTimeS != null ? formatLapTime(s.bestTimeS) : null,
        open: s.id === openId,
      };
    });
}
