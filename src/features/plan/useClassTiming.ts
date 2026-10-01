import {useMemo} from 'react';

import {paceClass} from '@/src/analysis/classLaps';
import {useSessions} from '@/src/data/sessions';

import {
  classSessionOf,
  classTiming,
  type ClassSession,
  leaderLapOf,
} from './classTiming';
import {type Combo} from './model';
import {type usePlanData} from './usePlanData';

// Every session he has driven, like the Plan screen's.
const ALL_TIME_DAYS = 3650;

/** Every race and practice at the combo's track with a field; null while the list loads. */
function useTrackClassSessions(combo: Combo | null): ClassSession[] | null {
  const sessions = useSessions({ageDays: ALL_TIME_DAYS});
  return useMemo(() => {
    if (sessions.isPending) return null;
    return (sessions.data?.items ?? []).flatMap(s => {
      const inPool =
        combo != null &&
        s.trackId === combo.trackId &&
        (s.sessionType === 'R' || s.sessionType === 'P');
      const pooled = inPool ? classSessionOf(s) : null;
      return pooled ? [pooled] : [];
    });
  }, [sessions.isPending, sessions.data, combo]);
}

/** The overall leader's median lap at the plan's track, for the timed race's late flag; null without one. */
export function useLeaderLap(combo: Combo | null): number | null {
  const pooled = useTrackClassSessions(combo);
  return useMemo(() => (pooled ? leaderLapOf(pooled) : null), [pooled]);
}

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
) {
  const pooled = useTrackClassSessions(combo);
  const {plan, greenLaps, hist} = data;
  const carClass = combo?.sessions[0]?.carClass ?? '';
  const timing = useMemo(
    () =>
      pooled == null
        ? null
        : classTiming({
            sessions: pooled,
            mine: {
              key: carClass ? paceClass(carClass) : null,
              name: carClass,
              medianLapS: plan?.perLap.lapTimeS?.median ?? null,
              greenLaps: greenLaps.length,
              sessions: hist.usedSessions.length,
            },
            raceLaps: plan?.raceLaps?.estimate ?? null,
            stopsAfter: plan?.atMedian.stopLaps ?? [],
          }),
    [
      pooled,
      carClass,
      plan,
      greenLaps,
      hist.usedSessions,
    ],
  );
  return timing;
}
