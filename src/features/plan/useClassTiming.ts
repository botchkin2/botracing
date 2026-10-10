import {useMemo} from 'react';

import {useSessions} from '@/src/data/sessions';

import {classTiming} from './classTiming';
import {classPaceInput} from './classPaceInput';
import {type Combo} from './model';
import {type usePlanData} from './usePlanData';

// Every session he has driven, like the Plan screen's.
const ALL_TIME_DAYS = 3650;

/**
 * Class pace for the Plan's track: every race and practice there in the same
 * sim with a field counts, whatever car he drove, against his own median lap
 * and the race from the plan in force. The session list carries each
 * session's class pace, so nothing but the list is fetched; null while it
 * loads.
 */
export function useClassTiming(
  combo: Combo | null,
  data: ReturnType<typeof usePlanData>,
  /** The pit-lap slider's stops and finish, in place of the plan's own. */
  chosen: {raceLaps: number; stopsAfter: number[]} | null = null,
) {
  const sessions = useSessions({ageDays: ALL_TIME_DAYS});
  const {plan, greenLaps, hist} = data;
  return useMemo(
    () =>
      sessions.isPending || combo == null
        ? null
        : classTiming(
            classPaceInput({
              combo,
              sessions: sessions.data?.items ?? [],
              plan: plan && {
                medianLapS: plan.perLap.lapTimeS?.median ?? null,
                greenLaps: greenLaps.length,
                sessions: hist.usedSessions.length,
                raceLaps: plan.raceLaps?.estimate ?? null,
                // The stops are planned at p90 use, like the pit windows (thread 44 #1662).
                stopsAfter: plan.atP90.stopLaps,
              },
              chosen,
            }),
          ),
    [
      sessions.isPending,
      sessions.data,
      combo,
      plan,
      greenLaps,
      hist.usedSessions,
      chosen,
    ],
  );
}
