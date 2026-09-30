import {useMemo} from 'react';

import {paceClass} from '@/src/analysis/classLaps';
import {
  type SessionDetail,
  useSessions,
  useSessionsDetail,
} from '@/src/data/sessions';

import {type ClassSession, classTiming} from './classTiming';
import {type Combo} from './model';
import {type usePlanData} from './usePlanData';

// Every session he has driven, like the Plan screen's.
const ALL_TIME_DAYS = 3650;

/**
 * The one place the stored `classLaps` of a session becomes the class timing
 * model's input: qualifying has no class laps and is left out; a session
 * without a field is left out.
 */
export function classSessionOf(d: SessionDetail): ClassSession | null {
  const doc = d.classLaps;
  if (!doc || doc.kind === 'qualify' || !doc.classes) return null;
  const byClass: ClassSession['byClass'] = {};
  for (const [key, stats] of Object.entries(doc.classes)) {
    byClass[key as keyof ClassSession['byClass']] = {
      medianS: stats.medianS,
      laps: stats.laps,
    };
  }
  return {kind: doc.kind, byClass};
}

/**
 * Class timing for the Plan's track: every race and practice there with a
 * field counts, whatever car he drove, against his own median lap and race
 * from the plan in force. Null while the sessions load.
 */
export function useClassTiming(
  combo: Combo | null,
  data: ReturnType<typeof usePlanData>,
) {
  const sessions = useSessions({ageDays: ALL_TIME_DAYS});
  const ids = useMemo(
    () =>
      (sessions.data?.items ?? [])
        .filter(
          s =>
            combo != null &&
            s.trackId === combo.trackId &&
            (s.sessionType === 'R' || s.sessionType === 'P'),
        )
        .map(s => s.id),
    [sessions.data, combo],
  );
  const details = useSessionsDetail(ids);
  const {plan, greenLaps, hist} = data;
  const carClass = combo?.sessions[0]?.carClass ?? '';
  const pending = sessions.isPending || details.details.some(d => !d);
  const timing = useMemo(
    () =>
      pending
        ? null
        : classTiming({
            sessions: details.details.flatMap(d => {
              const s = d ? classSessionOf(d) : null;
              return s ? [s] : [];
            }),
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
    [pending, details.details, carClass, plan, greenLaps, hist.usedSessions],
  );
  return timing;
}
