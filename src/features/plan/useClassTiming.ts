import {useMemo} from 'react';

import {paceClass} from '@/src/analysis/classLaps';
import {useSessions} from '@/src/data/sessions';

import {classSessionOf, classTiming} from './classTiming';
import {type Combo} from './model';
import {type usePlanData} from './usePlanData';

// Every session he has driven, like the Plan screen's.
const ALL_TIME_DAYS = 3650;

/**
 * Class timing for the Plan's track: every race and practice there with a
 * field counts, whatever car he drove, against his own median lap and race
 * from the plan in force. His class is that of the newest session of the
 * plan's track and car. The session list carries each session's class pace,
 * so nothing but the list is fetched; null while it loads.
 */
export function useClassTiming(
  combo: Combo | null,
  data: ReturnType<typeof usePlanData>,
  /** The pit-lap slider's stops and finish, in place of the plan's own. */
  chosen: {raceLaps: number; stopsAfter: number[]} | null = null,
) {
  const sessions = useSessions({ageDays: ALL_TIME_DAYS});
  const chosenKey = chosen?.stopsAfter.join(',');
  const {plan, greenLaps, hist} = data;
  const carClass = combo?.sessions[0]?.carClass ?? '';
  const timing = useMemo(
    () =>
      sessions.isPending
        ? null
        : classTiming({
            sessions: (sessions.data?.items ?? []).flatMap(s => {
              const inPool =
                combo != null &&
                s.trackId === combo.trackId &&
                (s.sessionType === 'R' || s.sessionType === 'P');
              const pooled = inPool ? classSessionOf(s) : null;
              return pooled ? [pooled] : [];
            }),
            mine: {
              key: carClass ? paceClass(carClass) : null,
              name: carClass,
              medianLapS: plan?.perLap.lapTimeS?.median ?? null,
              greenLaps: greenLaps.length,
              sessions: hist.usedSessions.length,
            },
            raceLaps: chosen?.raceLaps ?? plan?.raceLaps?.estimate ?? null,
            // The stops are planned at p90 use, like the pit windows (thread 44 #1662).
            stopsAfter: chosen?.stopsAfter ?? plan?.atP90.stopLaps ?? [],
          }),
    [
      sessions.isPending,
      sessions.data,
      combo,
      carClass,
      plan,
      greenLaps,
      hist.usedSessions,
      chosen?.raceLaps,
      chosenKey,
    ],
  );
  return timing;
}
