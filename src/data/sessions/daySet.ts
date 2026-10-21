import {
  MIN_EVENT_LAPS,
  type PaceLap,
  sectionTimesOf,
  slowLapIds,
} from '@/src/analysis/paceEvents';

import {type Lap} from './adapters';
import {paceCandidates} from './defaultLaps';

// A sitting's laps as one set (pit-wall thread 88, chord's day set #5950): the
// sessions of one track, car and type run back to back, derived from the
// sessions list, never stored. The pure parts: the merged lap list and the
// protected selection rule run on the bigger set, nothing added to it.

/** One session of a sitting, as the day set reads it. */
export type DayMember = {
  sessionId: string;
  /** A race keeps each lap's racing number (lapNo); other laps are named by
   *  their place in the day. */
  race: boolean;
  laps: Lap[];
};

/** The id Compare gives a lap of another session (useCompareModel.ts): one id scheme, not a new one. */
export const dayLapId = (sessionId: string, lapId: string) =>
  `${sessionId}~${lapId}`;

/**
 * The members' laps as one list in driving order: ids `sessionId~lapId`,
 * stints renumbered so none spans two sessions (a session break is a stint
 * break, as it is on track), lap numbers running on from 1 (a race's keep
 * the green-flag count). Everything else
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
        lapNo: m.race ? lap.lapNo : out.length + 1,
        stint: stintOf.get(lap.stint) as number,
      });
    }
  }
  return out;
}

/** Laps the uploader's slow rule looks at: no stored reason but 'slow' (src/analysis/paceEvents.ts, tools/sessions/analyze.mjs markSlow). */
const isJudged = (l: Lap) => l.reasons.every(r => r === 'slow');

/**
 * Whether the members' judged laps may be read by their section times: every
 * one was cut at the same boundaries (version and revision). False when one has
 * none or they differ: the set is then lap time only, never a mix.
 */
export function dayUsesSections(members: readonly DayMember[]): boolean {
  const laps = members.flatMap(m => paceCandidates(m.laps).filter(isJudged));
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

/** The members' judged laps as the uploader's rule takes them: a stint per session stint, laps in order. */
function paceOf(
  members: readonly DayMember[],
  useSections: boolean,
): PaceLap[] {
  const stintOf = new Map<string, number>();
  const stintLaps = new Map<number, number>();
  const pace: PaceLap[] = [];
  for (const m of members) {
    for (const l of paceCandidates(m.laps).filter(isJudged)) {
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
  }
  return pace;
}

/**
 * The slow laps of the day (merged ids). The uploader's own rule, with the
 * verdict rule of thread 88 (chord #6031, gauge #6035): a member with
 * MIN_EVENT_LAPS or more judged laps keeps its own verdict, the one its session
 * would give alone; only a shorter member, which judges nothing alone, is
 * judged by the day, on the limit of every member's laps together. A lap the
 * session already calls slow is never called clean by pooling it with others
 * (the day's wider spread had turned 13 of 738 clearly slow laps clean).
 * Sections are read only where the laps were cut at the same boundaries (a
 * member's own, for its own verdict; every member's, for the day's); otherwise
 * lap time alone, never a mix.
 */
export function daySlowIds(members: readonly DayMember[]): Set<string> {
  const pooled = slowLapIds(paceOf(members, dayUsesSections(members)));
  const out = new Set<string>();
  for (const m of members) {
    const own = paceCandidates(m.laps).filter(isJudged).length;
    const verdict =
      own >= MIN_EVENT_LAPS
        ? slowLapIds(paceOf([m], dayUsesSections([m])))
        : pooled;
    for (const l of paceCandidates(m.laps)) {
      const id = dayLapId(m.sessionId, l.id);
      if (verdict.has(id)) out.add(id);
    }
  }
  return out;
}

/**
 * The laps the day view opens on (merged ids): every candidate lap that is not
 * slow in the day, across all stints, as `paceSetLapIds` does for a session;
 * under two there is no set.
 */
export function dayLapIds(members: readonly DayMember[]): string[] {
  const slow = daySlowIds(members);
  const set = members.flatMap(m =>
    paceCandidates(m.laps)
      .map(l => dayLapId(m.sessionId, l.id))
      .filter(id => !slow.has(id)),
  );
  return set.length >= 2 ? set : [];
}

/** The fastest comparable lap of a day's merged laps (a day has no stored best); null with none. */
export function dayBestLapId(laps: readonly Lap[]): string | null {
  let best: Lap | null = null;
  for (const l of laps)
    if (
      l.comparable &&
      l.timeS != null &&
      (!best || l.timeS < (best.timeS as number))
    )
      best = l;
  return best?.id ?? null;
}
