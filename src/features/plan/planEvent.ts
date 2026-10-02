// The Plan's rules unit is the event: a track and car in one series week
// (pit-wall thread 44 #1983, parc's 9-month audit #1980). The load, the start
// cap and the litres per 1 % VE belong to the event, and practice, qualifying
// and race of one event agree on them; they differ between events of the same
// track and car, and the fill level does not predict them. The series name is
// a label when a join has it, never the key. Pure.
import type {SessionSummary} from '@/src/data/sessions';

// The series schedule turns over on Tuesday evening (Botkin, #1972).
const TURNOVER_DAY = 2;
const TURNOVER_HOUR = 18;

/** The Tuesday (local date, YYYY-MM-DD) that began the series week this time falls in. */
export function seriesWeek(startedAt: string): string {
  const t = new Date(startedAt);
  t.setHours(t.getHours() - TURNOVER_HOUR);
  const back = (t.getDay() - TURNOVER_DAY + 7) % 7;
  t.setDate(t.getDate() - back);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

export type PlanEvent = {
  /** The Tuesday that began its series week; the event's key within a track and car. */
  week: string;
  /** Its sessions, newest first. */
  sessionIds: string[];
  /** The series name when a join named it; null otherwise. */
  series: string | null;
};

/** The events a track and car's sessions fall in, newest first. `sessions` is newest first. */
export function eventsOf(sessions: SessionSummary[]): PlanEvent[] {
  const byWeek = new Map<string, PlanEvent>();
  for (const s of sessions) {
    const week = seriesWeek(s.startedAt);
    const e = byWeek.get(week) ?? {week, sessionIds: [], series: null};
    e.sessionIds.push(s.id);
    e.series = e.series ?? s.series;
    byWeek.set(week, e);
  }
  return [...byWeek.values()].sort((a, b) => b.week.localeCompare(a.week));
}

/** "One Stint Sprint · week of 09-29 · 100 L"; the series and the load only when known. */
export function eventLabel(e: PlanEvent, loadL: number | null): string {
  return [
    e.series,
    `week of ${e.week.slice(5)}`,
    loadL != null ? `${Math.round(loadL * 10) / 10} L` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
