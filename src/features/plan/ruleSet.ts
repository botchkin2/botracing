// The Plan's rules unit is a rule set: the sessions of one track and car whose
// litres per 1 % VE agree. A series week is only a label. Practice, qualifying
// and race of one event agree on the ratio to 0.005; two weeks of rules differ
// by far more (Sebring: 0.835 to 0.837 against 0.625), so the ratio finds the
// sessions that ran the same rules even across a turnover of the schedule or a
// practice that ran last week's (pit-wall thread 104). Pure.
import type {SessionType} from '@/src/data/sessions';

/** A rule set's ratios spread no further than this (max - min), so a chain of small steps cannot drift into one set. */
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
  /** The setup's `VM_FUEL_LEVEL.maxValue`: the event's limit when it caps the fill, else the car's tank. */
  tankL: number | null;
  startL: number | null;
  /** Played online (true) or offline (false); null when the capture did not say. */
  online: boolean | null;
  /** LMU's own VE setting in the setup, and its VE a lap at it (`fuel.setupVePerLapPct`); null without the setup. */
  setupVePct: number | null;
  setupVePerLapPct: number | null;
};

export type RuleSet = {
  /** The newest session's id: names the set in the picker. */
  key: string;
  /** Its sessions, newest first. */
  sessionIds: string[];
  /** The newest session's start. */
  newestAt: string;
  /** The ratio to plan with and the session it comes from. */
  ratio: {perPctL: number; from: {
      id: string;
      startedAt: string;
      sessionType: SessionType;
      online: boolean | null;
    };
  };
  /** No race or qualifying in the set: the ratio is a practice's and may differ from the race's. */
  fromPracticeOnly: boolean;
  /** The litres per 1 % VE a stop adds (the newest stop measured in the set); null with none. */
  stopRatio: number | null;
  /** The load: the source session's fill limit, else the newest in the set, else the newest race's start (his setup's fuel, not the event's cap); null with none. */
  mostRunL: number | null;
};

/**
 * The rule sets of a track and car, newest first. `sessions` is newest first.
 * Each session joins the first set whose ratios, with its own, spread no more
 * than the tolerance (newest first, so the newest rules anchor their set); a
 * session with no ratio is in no set (it has no VE to plan with).
 */
export function ruleSetsOf(sessions: RuleSession[]): RuleSet[] {
  const groups: {sessions: RuleSession[]; min: number; max: number}[] = [];
  for (const s of sessions) {
    if (s.ratio == null) continue;
    const g = groups.find(
      x =>
        Math.max(x.max, s.ratio as number) - Math.min(x.min, s.ratio as number) <=
        RATIO_TOLERANCE + 1e-9,
    );
    if (g) {
      g.sessions.push(s);
      g.min = Math.min(g.min, s.ratio);
      g.max = Math.max(g.max, s.ratio);
    } else groups.push({sessions: [s], min: s.ratio, max: s.ratio});
  }
  return groups.map(g => setOf(g.sessions));
}

function setOf(g: RuleSession[]): RuleSet {
  const newest = g[0];
  // the source: the newest race or qualifying, whose ratio, load and stop ratio the plan takes
  const source = g.find(s => s.sessionType === 'R' || s.sessionType === 'Q');
  const first = source ?? newest;
  // stop ratio: the source's own, then the newest race, qualifying, practice
  const byType = (t: SessionType) => g.filter(s => s.sessionType === t);
  const stop = [first, ...byType('R'), ...byType('Q'), ...byType('P')].find(
    s => s.stopRatio != null,
  );
  // load: the source's fill limit, else the newest fill limit in the set, else
  // the newest race's start; a practice's or a qualifying's start (17.4 L,
  // 20.4 L) is never the load
  const fill = first.fillLimitL ?? g.find(s => s.fillLimitL != null)?.fillLimitL;
  const raceStart = g.find(s => s.sessionType === 'R' && s.startL != null)?.startL;
  return {
    key: newest.id,
    sessionIds: g.map(s => s.id),
    newestAt: newest.startedAt,
    ratio: {
      perPctL: first.ratio as number,
      from: {
        id: first.id,
        startedAt: first.startedAt,
        sessionType: first.sessionType,
        online: first.online,
      },
    },
    fromPracticeOnly: source == null,
    stopRatio: stop?.stopRatio ?? null,
    mostRunL: fill ?? raceStart ?? null,
  };
}
