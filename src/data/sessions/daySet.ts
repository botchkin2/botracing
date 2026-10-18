import {
  type PaceLap,
  sectionTimesOf,
  slowLapIds,
} from '@/src/analysis/paceEvents';

import {type Lap} from './adapters';

// A sitting's laps as one set (pit-wall thread 88, chord's day set #5950): the
// sessions of one track, car and type run back to back, derived from the
// sessions list, never stored. The pure parts: the merged lap list and the
// protected selection rule run on the bigger set, nothing added to it.

/** One session of a sitting, as the day set reads it. */
export type DayMember = {
  sessionId: string;
  /** The session's analysis is current (the detail's `stale` is false): its stored slow verdicts come from the rules the app runs now. */
  current: boolean;
  laps: Lap[];
};

/** The id Compare gives a lap of another session (useCompareModel.ts): one id scheme, not a new one. */
export const dayLapId = (sessionId: string, lapId: string) =>
  `${sessionId}~${lapId}`;

/**
 * The members' laps as one list in driving order: ids `sessionId~lapId`,
 * stints renumbered so none spans two sessions (a session break is a stint
 * break, as it is on track), lap numbers running on from 1. Everything else
 * on a lap is carried unchanged.
 */
export function mergeDayLaps(members: readonly DayMember[]): Lap[] {
  const out: Lap[] = [];
  let stint = 0;
  for (const m of members) {
    const stintOf = new Map<number, number>();
    for (const lap of m.laps) {
      if (!stintOf.has(lap.stint)) stintOf.set(lap.stint, ++stint);
      out.push({
        ...lap,
        id: dayLapId(m.sessionId, lap.id),
        lapIndex: out.length + 1,
        stint: stintOf.get(lap.stint) as number,
      });
    }
  }
  return out;
}

/** The laps whose pace is judged: timed, whole, not in or out of the pits (as the uploader's candidates). */
const isCandidate = (l: Lap) =>
  l.timeS != null && !l.partial && !l.pitIn && !l.pitOut;

/** Laps the uploader's slow rule looks at: no stored reason but 'slow' (src/analysis/paceEvents.ts, tools/sessions/analyze.mjs markSlow). */
const isJudged = (l: Lap) => l.reasons.every(r => r === 'slow');

/**
 * Whether the day may read section times: every judged lap of every member was
 * cut at the same boundaries (version and revision). False when one has none or
 * they differ: the whole day is then lap time only, never a mix.
 */
export function dayUsesSections(members: readonly DayMember[]): boolean {
  const laps = members.flatMap(m =>
    m.laps.filter(l => isCandidate(l) && isJudged(l)),
  );
  const first = laps[0]?.cornerBoundaries;
  return (
    first != null &&
    laps.every(
      l =>
        l.cornerBoundaries?.v === first.v &&
        l.cornerBoundaries?.rev === first.rev,
    )
  );
}

/**
 * The slow laps of the day (merged ids), the uploader's own rule run on all
 * the members' laps at once, so a session under MIN_EVENT_LAPS laps is judged
 * against the day's pace with the day's limit. Sections are used only when
 * every judged lap was cut at the same boundaries; one that was not makes the
 * whole day lap-time only, never a mix. Null when a member's stored verdicts
 * are from other rules: the day waits for its re-analysis on open.
 */
export function daySlowIds(members: readonly DayMember[]): Set<string> | null {
  if (members.some(m => !m.current)) return null;
  const judged = members.flatMap(m =>
    m.laps.filter(l => isCandidate(l) && isJudged(l)).map(l => ({m, l})),
  );
  const useSections = dayUsesSections(members);
  const stintOf = new Map<string, number>();
  const stintLaps = new Map<number, number>();
  const pace: PaceLap[] = [];
  for (const {m, l} of judged) {
    const key = `${m.sessionId}:${l.stint}`;
    if (!stintOf.has(key)) stintOf.set(key, stintOf.size + 1);
    const stint = stintOf.get(key) as number;
    const stintLap = stintLaps.get(stint) ?? 0;
    stintLaps.set(stint, stintLap + 1);
    pace.push({
      id: dayLapId(m.sessionId, l.id),
      stint,
      stintLap,
      lapTime: l.timeS as number,
      sections: useSections
        ? sectionTimesOf(
            l.startStraight?.segTimeS,
            l.sections.map(s => s.segTimeS),
          )
        : null,
    });
  }
  return slowLapIds(pace);
}

/**
 * The laps the day view opens on (merged ids): every candidate lap that is not
 * slow in the day, across all stints, as `paceSetLapIds` does for a session;
 * under two there is no set. Null while a member awaits re-analysis.
 */
export function dayLapIds(members: readonly DayMember[]): string[] | null {
  const slow = daySlowIds(members);
  if (!slow) return null;
  const set = members.flatMap(m =>
    m.laps
      .filter(isCandidate)
      .map(l => dayLapId(m.sessionId, l.id))
      .filter(id => !slow.has(id)),
  );
  return set.length >= 2 ? set : [];
}
