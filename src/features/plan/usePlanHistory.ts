import {useMemo} from 'react';

import {sinceChange} from '@/src/analysis/fuelHistory';
import {
  useSession,
  useSessionsDetail,
  useSessionsLaps,
} from '@/src/data/sessions';
import {type FuelPreset} from '@/src/state/fuelPresets';

import {
  type Combo,
  greenLapsOf,
  historySessions,
  limitsOfDetails,
  veRatioFor,
  veRatioOf,
} from './model';

/**
 * The first half of the plan's data: the fill limit of every session at a
 * track and car, and the newest one's fuel. The Plan screen and the race's
 * "plan vs what happened" card both read the history through these two hooks,
 * so the two never disagree (pit-wall thread 42).
 */
export function usePlanLimits(combo: Combo | null) {
  const allIds = useMemo(
    () => (combo ? combo.sessions.map(s => s.id) : []),
    [combo],
  );
  const allDetails = useSessionsDetail(allIds);
  // No session at the track and car yet: nothing to read (an empty id would
  // request /sessions/ and 404).
  const last = useSession(allIds[0] ?? '', allIds.length > 0);
  return {
    lastFuel: last.data?.fuel ?? null,
    ...limitsOfDetails(allDetails.details, allDetails.pending),
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
) {
  const history =
    combo && wantedL != null ? historySessions(combo, limitsL) : [];
  const ids = history.map(s => s.id);
  const lapsOf = useSessionsLaps(ids);
  const sessionDetails = useSessionsDetail(ids);

  // The litres one VE % is worth: the preset's, else measured in the newest
  // session there (VE % per lap depends on the load; thread 35 #1004).
  const measured = history.map((s, i) => ({
    startedAt: s.startedAt,
    // The uploader's value first (analysisVersion 11), else measured here.
    ratio:
      sessionDetails.details[i]?.fuel?.litresPerVePct ??
      (lapsOf.laps[i] ? veRatioOf(lapsOf.laps[i]) : null),
    fillLimitL: sessionDetails.details[i]?.fuel?.fillLimitL ?? null,
  }));
  const ratio = veRatioFor(preset, measured, wantedL);
  const perSession = history.map((s, i) => ({
    id: s.id,
    laps: lapsOf.laps[i]
      ? greenLapsOf(s.id, lapsOf.laps[i], ratio ? ratio.perPctL : null)
      : [],
  }));
  // Laps from before a jump in use are left out (thread 36 #1102).
  const chosen = sinceChange(perSession);
  const usedSessions = history.filter(s => chosen.sessionIds.includes(s.id));
  return {
    history,
    lapsOf,
    sessionDetails,
    measured,
    ratio,
    chosen,
    usedSessions,
  };
}
