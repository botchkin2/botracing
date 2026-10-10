import {useMemo} from 'react';

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
  historySessions,
  limitsOfPlan,
  veRatioFor,
} from './model';
import {eventsOf} from './planEvent';

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
    () => new Map<string, PlanSession>((query.data?.items ?? []).map(s => [s.id, s])),
    [query.data],
  );
  return {
    byId,
    /** True while the request is in flight (and for a combo not chosen yet it is false). */
    pending: combo != null && query.isPending,
    failed: query.isError,
  };
}

/**
 * The first half of the plan's data: the fill limit of every session at a
 * track and car, and the newest one's fuel. The Plan screen and the race's
 * "plan vs what happened" card both read the history through these two hooks.
 */
export function usePlanLimits(
  combo: Combo | null,
  /** The series week of the planned event; null is the newest one. */
  eventWeek: string | null = null,
) {
  const rows = usePlanRows(combo);
  const events = useMemo(
    () => (combo ? eventsOf(combo.sessions) : []),
    [combo],
  );
  const event = events.find(e => e.week === eventWeek) ?? events[0] ?? null;
  const fuelOf = (id: string): SessionFuel | null =>
    rows.byId.get(id)?.plan?.fuel ?? null;
  // The event's full load is the largest over its sessions, not the newest's.
  const load = event ? eventLoad(event.sessionIds.map(fuelOf)) : null;
  const newestFuel = event?.sessionIds[0] ? fuelOf(event.sessionIds[0]) : null;
  const lastFuel =
    newestFuel && load
      ? {
          ...newestFuel,
          fillLimitL: load.kind === 'fill limit' ? load.litres : null,
          startL: load.kind === 'start fuel' ? load.litres : newestFuel.startL,
          tankL: load.kind === 'tank' ? load.litres : newestFuel.tankL,
        }
      : newestFuel;
  return {
    lastFuel,
    events,
    event,
    rows,
    ...limitsOfPlan(
      combo ? combo.sessions.map(s => rows.byId.get(s.id)) : [],
      rows.pending,
    ),
  };
}

/**
 * The second half: the newest sessions at the track and car whatever load they
 * ran, their green laps in litres with VE worked out through the ratio of the
 * wanted load, and the laps since a jump in use (thread 36 #1102).
 */
export function usePlanHistory(
  combo: Combo | null,
  limitsL: (number | null | undefined)[],
  wantedL: number | null,
  preset: FuelPreset | null,
  /** The sessions of the planned event, whose ratio the plan takes; unset, every session counts as in it. */
  eventIds: string[] | null = null,
) {
  const rows = usePlanRows(combo);
  const history =
    combo && wantedL != null
      ? historySessions(combo, limitsL, eventIds ?? [])
      : [];
  const planOf = (id: string) => rows.byId.get(id)?.plan ?? null;

  // The litres one VE % is worth: the preset's, else the uploader's value for
  // the newest session there (VE % per lap depends on the load; thread 35
  // #1004). A session whose block has none has none.
  const measured = history.map(s => ({
    startedAt: s.startedAt,
    ratio: planOf(s.id)?.fuel.litresPerVePct ?? null,
    fillLimitL: planOf(s.id)?.fuel.fillLimitL ?? null,
    inEvent: eventIds == null || eventIds.includes(s.id),
  }));
  const ratio = veRatioFor(preset, measured);
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
  const usedSessions = history.filter(s => chosen.sessionIds.includes(s.id));
  // The driver's own races here: their race sides give the formation burn and
  // the pit lane base.
  const races = history.flatMap(s => {
    const race = s.sessionType === 'R' ? planOf(s.id)?.race : null;
    return race ? [race] : [];
  });
  return {
    history,
    /** Loading state of the one request (the screens used to count lap fetches). */
    loading: {pending: rows.pending, failed: rows.failed},
    measured,
    ratio,
    chosen,
    usedSessions,
    races,
    formationBurnsL: races.map(r => r.formationL),
  };
}
