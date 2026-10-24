// The Plan's rules unit is a rule set: the sessions of one track and car whose
// litres per 1 % VE agree. A series week is only a label. Practice, qualifying
// and race of one event agree on the ratio to 0.005; two weeks of rules differ
// by far more (Sebring: 0.835 to 0.837 against 0.625), so the ratio finds the
// sessions that ran the same rules even across a turnover of the schedule or a
// practice that ran last week's (pit-wall thread 104). Pure.
import type {SessionType} from '@/src/data/sessions';

/** Two sessions are one rule set when their ratios are this close, chained. */
export const RATIO_TOLERANCE = 0.015;

export type RuleSession = {
  id: string;
  startedAt: string;
  sessionType: SessionType;
  /** Litres of fuel per 1 % VE on track; null for a session with no VE. */
  ratio: number | null;
  /** The same from what the stops added: his setup's fuel ratio; null without a stop. */
  stopRatio: number | null;
  fillLimitL: number | null;
  startL: number | null;
};

export type RuleSet = {
  /** The newest session's id: names the set in the picker. */
  key: string;
  /** Its sessions, newest first. */
  sessionIds: string[];
  /** The newest session's start. */
  newestAt: string;
  /** The ratio to plan with and the session it comes from. */
  ratio: {perPctL: number; from: {startedAt: string; sessionType: SessionType}};
  /** No race or qualifying in the set: the ratio is a practice's and may differ from the race's. */
  fromPracticeOnly: boolean;
  /** The litres per 1 % VE a stop adds (the newest stop measured in the set); null with none. */
  stopRatio: number | null;
  /** The most fuel he has run in this set (his setup's, not the event's cap); null with none. */
  mostRunL: number | null;
};

/**
 * The rule sets of a track and car, newest first. `sessions` is newest first.
 * A session with no ratio is in no set (it has no VE to plan with).
 */
export function ruleSetsOf(sessions: RuleSession[]): RuleSet[] {
  const withRatio = sessions.filter(s => s.ratio != null);
  // chain the ratios in order: neighbours within the tolerance are one set
  const byRatio = [...withRatio].sort((a, b) => (a.ratio as number) - (b.ratio as number));
  const groups: RuleSession[][] = [];
  for (const s of byRatio) {
    const last = groups[groups.length - 1];
    const top = last?.[last.length - 1];
    if (top && (s.ratio as number) - (top.ratio as number) <= RATIO_TOLERANCE + 1e-9)
      last.push(s);
    else groups.push([s]);
  }
  return groups
    .map(g => g.sort((a, b) => b.startedAt.localeCompare(a.startedAt)))
    .map(setOf)
    .sort((a, b) => b.newestAt.localeCompare(a.newestAt));
}

function setOf(g: RuleSession[]): RuleSet {
  const newest = g[0];
  const racing = g.find(s => s.sessionType === 'R' || s.sessionType === 'Q');
  const source = racing ?? newest;
  const stop = g.find(s => s.stopRatio != null);
  const fills = g.flatMap(s => (s.fillLimitL == null ? [] : [s.fillLimitL]));
  const newestRace = g.find(s => s.sessionType === 'R' && s.startL != null);
  return {
    key: newest.id,
    sessionIds: g.map(s => s.id),
    newestAt: newest.startedAt,
    ratio: {
      perPctL: source.ratio as number,
      from: {startedAt: source.startedAt, sessionType: source.sessionType},
    },
    fromPracticeOnly: racing == null,
    stopRatio: stop?.stopRatio ?? null,
    // A practice or qualifying start (17.4 L, 20.4 L) is never the load.
    mostRunL: fills.length > 0 ? Math.max(...fills) : newestRace?.startL ?? null,
  };
}
