// The Plan's rules unit is the rule set (ruleSet.ts): the sessions of one track
// and car that ran the same rules, found by their litres per 1 % VE, not by the
// calendar (pit-wall thread 104: a practice can run last week's rules, and a
// week can hold two). The load, the start cap and the ratio belong to it. A
// car with no VE at all (a fuel-only class) has no ratio to group by, so its
// events stay the series weeks (pit-wall thread 44 #1983). The series name is
// a label when a join has it, never the key. Pure.
import type {SessionSummary, SessionType} from '@/src/data/sessions';
import {formatDayMonth} from '@/src/design/format';

import type {RuleSet} from './ruleSet';

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
  /** What names it within a track and car: its rule set's key, or its series week's Tuesday. */
  key: string;
  /** Its sessions, newest first. */
  sessionIds: string[];
  /** The series name when a join named it; null otherwise. */
  series: string | null;
  /** The rules its sessions ran; null for a series week of a car with no VE. */
  rules: RuleSet | null;
};

/**
 * The events a track and car's sessions fall in, newest first: its rule sets,
 * else (no session has a ratio) its series weeks. `sessions` is newest first.
 */
export function eventsOf(
  sessions: SessionSummary[],
  rules: RuleSet[] = [],
): PlanEvent[] {
  if (rules.length > 0) {
    const series = new Map(sessions.map(s => [s.id, s.series]));
    return rules.map(r => ({
      key: r.key,
      sessionIds: r.sessionIds,
      series: r.sessionIds.map(id => series.get(id) ?? null).find(Boolean) ?? null,
      rules: r,
    }));
  }
  const byWeek = new Map<string, PlanEvent>();
  for (const s of sessions) {
    const week = seriesWeek(s.startedAt);
    const e = byWeek.get(week) ?? {key: week, sessionIds: [], series: null, rules: null};
    e.sessionIds.push(s.id);
    e.series = e.series ?? s.series;
    byWeek.set(week, e);
  }
  return [...byWeek.values()].sort((a, b) => b.key.localeCompare(a.key));
}

export const TYPE_WORD: Record<SessionType, string> = {R: 'race', Q: 'qualifying', P: 'practice'};

/** "Rules from your offline practice, Oct 26": which session the plan's rules come from, so a stale set is visible. */
export function rulesSource(rules: RuleSet): string {
  const {startedAt, sessionType, online} = rules.ratio.from;
  const mode = online == null ? '' : online ? 'online ' : 'offline ';
  return `Rules from your ${mode}${TYPE_WORD[sessionType]}, ${formatDayMonth(startedAt)}`;
}

/**
 * "Rules from your offline practice, Oct 26 · One Stint Sprint" for a rule
 * set (its date tells two sets apart; its max fuel is the Plan's own fact
 * line), or for a car with no VE "100 L · One Stint Sprint · week of 09-29";
 * the load and the series only when known. The load leads there: on a phone
 * the Rules chip cuts its label with an ellipsis from the end, and the fuel
 * figure is the part that must stay.
 */
export function eventLabel(e: PlanEvent, loadL: number | null): string {
  return [
    e.rules ? rulesSource(e.rules) : null,
    e.rules || loadL == null ? null : `${Math.round(loadL * 10) / 10} L`,
    e.series,
    e.rules ? null : `week of ${e.key.slice(5)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}
