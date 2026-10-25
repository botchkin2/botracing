import {useMemo} from 'react';

import {readFailure} from '@/src/data/queryState';

import {sinceChange} from '@/src/analysis/fuelHistory';
import {
  type PlanSession,
  type SessionFuel,
  usePlanSessions,
} from '@/src/data/sessions';
import {type FuelPreset} from '@/src/state/fuelPresets';

import {
  type Combo,
  greenLapsOf,
  eventLoad,
  lastFuelOf,
  historySessions,
  limitsOfPlan,
  veRatioFor,
} from './model';
import {eventsOf} from './planEvent';
import {type RuleSet, ruleSetsOf} from './ruleSet';

/**
 * One request for the whole Plan: every session's plan block at a track and
 * car (`GET /plan`). The two hooks below, the Plan screen, the Track page's
 * Plan card and the race's "plan vs what happened" card all read it through
 * the same query key, so they share the one response and never disagree
 * (pit-wall thread 42, thread 1 #3485). There is no other path to the numbers:
 * a session with no block is "no data".
 */
export function usePlanRows(combo: Combo | null) {
  const query = usePlanSessions(
    combo
      ? {sim: combo.sim, trackId: combo.trackId, carModel: combo.car}
      : null,
  );
  const byId = useMemo(
    () =>
      new Map<string, PlanSession>(
        (query.data?.items ?? []).map(s => [s.id, s]),
      ),
    [query.data],
  );
  return {
    byId,
    /** True while the request is in flight (and for a combo not chosen yet it is false). */
    pending: combo != null && query.isPending,
    // Only a read with nothing kept failed: a refetch that fails keeps the plan (roadmap 6b).
    failure: readFailure(query),
    /** The request has answered: a session it does not list is no data, not loading. */
    answered: query.data != null,
    /**
     * The route cut the list at its cap (500 sessions, newest first). Nothing
     * reads past the newest few for the history, and a session the cut left out
     * is no data (limitsOfPlan with `answered`), so the plan is the same; the
     * flag is carried for a screen that wants to say so.
     */
    truncated: query.data?.truncated === true,
  };
}

/**
 * The first half of the plan's data: the fill limit of every session at a
 * track and car, and the newest one's fuel. The Plan screen and the race's
 * "plan vs what happened" card both read the history through these two hooks.
 */
export function usePlanLimits(
  combo: Combo | null,
  /** The key of the planned event (its rule set's, or a series week's); null is the newest one. */
  eventKey: string | null = null,
) {
  const rows = usePlanRows(combo);
  const events = useMemo(() => {
    if (!combo) return [];
    const ruleSessions = combo.sessions.flatMap(s => {
      const f = rows.byId.get(s.id)?.plan?.fuel;
      return f
        ? [
            {
              id: s.id,
              startedAt: s.startedAt,
              sessionType: s.sessionType,
              ratio: f.litresPerVePct,
              stopRatio: f.litresPerVePctStop,
              fillLimitL: f.fillLimitL,
              tankL: f.tankL,
              startL: f.startL,
              online: s.online,
              setupVePct: f.setupVePct,
              setupVePerLapPct: f.setupVePerLapPct,
            },
          ]
        : [];
    });
    return eventsOf(combo.sessions, ruleSetsOf(ruleSessions));
  }, [combo, rows.byId]);
  const event = events.find(e => e.key === eventKey) ?? events[0] ?? null;
  const fuelOf = (id: string): SessionFuel | null =>
    rows.byId.get(id)?.plan?.fuel ?? null;
  // The load is the most he has run in the rule set (his setup's fuel, not
  // the event's cap), never a practice's start: a series week with no rule
  // set (no VE) keeps the old reading, the largest over its sessions.
  const load = event?.rules
    ? event.rules.mostRunL != null
      ? {kind: 'fill limit' as const, litres: event.rules.mostRunL}
      : null
    : event
    ? eventLoad(event.sessionIds.map(fuelOf))
    : null;
  const newestFuel = event?.sessionIds[0] ? fuelOf(event.sessionIds[0]) : null;
  const lastFuel = lastFuelOf(newestFuel, load, event?.rules != null);
  return {
    lastFuel,
    events,
    event,
    rows,
    ...limitsOfPlan(
      combo ? combo.sessions.map(s => rows.byId.get(s.id)) : [],
      rows.pending,
      rows.answered,
    ),
  };
}

/**
 * The second half: the newest sessions at the track and car whatever load they
 * ran, their green laps in litres with VE worked out through the ratio of the
 * wanted load, and the laps since a jump in use (thread 36 #1102).
 */
/**
 * The sessions the plan's laps came from: in the chosen run and holding at
 * least one green lap. A session with none contributed nothing, so it is not
 * counted ("from 80 laps in 7 sessions", not 8).
 */
export function sessionsWithLaps<S extends {id: string}>(
  history: S[],
  perSession: {id: string; laps: unknown[]}[],
  chosenIds: string[],
): S[] {
  const withLaps = new Set(
    perSession.filter(p => p.laps.length > 0).map(p => p.id),
  );
  return history.filter(s => chosenIds.includes(s.id) && withLaps.has(s.id));
}

export function usePlanHistory(
  combo: Combo | null,
  limitsL: (number | null | undefined)[],
  /** The rules are known (a load, or VE alone): the history is read. */
  rulesKnown: boolean,
  preset: FuelPreset | null,
  /** The sessions of the planned event, whose ratio the plan takes; unset, every session counts as in it. */
  eventIds: string[] | null = null,
  /** The rule set of the planned event: where the ratio comes from; null for a car with no VE. */
  rules: RuleSet | null = null,
) {
  const rows = usePlanRows(combo);
  const history =
    combo && rulesKnown
      ? historySessions(combo, limitsL, eventIds ?? [])
      : [];
  const planOf = (id: string) => rows.byId.get(id)?.plan ?? null;

  // What each session of the history measured: the litres one VE % is worth
  // and its fill limit, for the stale-preset note and the rules editor's
  // "last session" hint. The ratio the plan uses is the rule set's (veRatioFor).
  // A session whose block has no ratio has none.
  const measured = history.map(s => ({
    startedAt: s.startedAt,
    ratio: planOf(s.id)?.fuel.litresPerVePct ?? null,
    fillLimitL: planOf(s.id)?.fuel.fillLimitL ?? null,
  }));
  const ratio = veRatioFor(preset, rules);
  const perSession = history.map(s => ({
    id: s.id,
    laps: greenLapsOf(
      s.id,
      planOf(s.id)?.laps ?? [],
      ratio ? ratio.perPctL : null,
    ),
  }));
  // Laps from before a jump in use are left out (thread 36 #1102).
  const chosen = sinceChange(perSession);
  const usedSessions = sessionsWithLaps(history, perSession, chosen.sessionIds);
  // The driver's own races here: their race sides give the formation burn and
  // the pit lane base.
  const races = history.flatMap(s => {
    const race = s.sessionType === 'R' ? planOf(s.id)?.race : null;
    return race ? [race] : [];
  });
  return {
    history,
    /** Loading state of the one request (the screens used to count lap fetches). */
    loading: {
      pending: rows.pending,
      failed: rows.failure !== null,
      offline: rows.failure === 'offline',
    },
    measured,
    ratio,
    chosen,
    usedSessions,
    races,
    formationBurnsL: races.map(r => r.formationL),
  };
}
