// Reference candidates for one lap from the other sessions at the same track
// and car (pit-wall thread 44 #1690, roadmap E3): the ranking is
// analysis/referenceLap.ts; this picks the pool and says, in numbers and
// matches only, what each candidate has in common with the lap. No verdict.
import {rankReferenceLaps, type RefMatch} from '@/src/analysis/referenceLap';
import {
  type Lap,
  refLapOf,
  type SessionDetail,
  type SessionSummary,
} from '@/src/data/sessions';
import {carLabel, formatDay, formatGap, formatLapTime} from '@/src/design';

/** How many other sessions join the pool: each is one lap list to fetch. */
export const POOL_SESSIONS = 4;
/** Candidates shown. */
export const CANDIDATES_SHOWN = 3;

/** Other sessions at this track with this car model, newest first, up to `POOL_SESSIONS`. */
export function poolSessions(
  current: Pick<SessionSummary, 'id' | 'trackId' | 'car' | 'cornerMapSource'>,
  all: SessionSummary[],
): SessionSummary[] {
  const model = carLabel(current.car).model;
  // A session with a corner map of its own (lap length off the track's by
  // more than 3 %) has sections that do not line up with the others', so
  // Compare could not put its laps beside this one's.
  if (current.cornerMapSource === 'session') return [];
  return all
    .filter(
      s =>
        s.id !== current.id &&
        s.cornerMapSource !== 'session' &&
        s.trackId === current.trackId &&
        carLabel(s.car).model === model,
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, POOL_SESSIONS);
}

export type PoolSource = {
  session: Pick<SessionSummary, 'id' | 'car' | 'sessionType' | 'startedAt'>;
  laps: Lap[];
};

export type Candidate = {
  sessionId: string;
  lapId: string;
  lapIndex: number;
  /** Null when the lap is from the session being looked at. */
  startedAt: string | null;
  sessionType: string;
  timeS: number;
  /** Candidate minus the lap, seconds; null when the lap itself is untimed. */
  deltaS: number | null;
  match: RefMatch;
};

/**
 * The best candidates for `target` from its own session and the pool.
 * `current` is the target's session; `others` are the pool's laps.
 */
export function referenceCandidates(
  target: Lap,
  current: Pick<SessionDetail, 'id' | 'car' | 'sessionType'>,
  currentLaps: Lap[],
  others: PoolSource[],
  shown = CANDIDATES_SHOWN,
): Candidate[] {
  const meta = (s: Pick<SessionSummary, 'id' | 'car' | 'sessionType'>) => ({
    id: s.id,
    car: carLabel(s.car).model,
    sessionType: s.sessionType,
  });
  const sources: PoolSource[] = [
    {session: {...current, startedAt: ''}, laps: currentLaps},
    ...others,
  ];
  // Lap ids are recordingId-NNN, unique across sessions, so the id alone
  // finds a lap (a lap's own session is in the same list as the pool's).
  const located = new Map<string, {lap: Lap; source: PoolSource}>();
  const refs = sources.flatMap(source =>
    source.laps.map(lap => {
      located.set(lap.id, {lap, source});
      return refLapOf(lap, meta(source.session));
    }),
  );
  const ranked = rankReferenceLaps(refLapOf(target, meta(current)), refs).slice(
    0,
    shown,
  );
  return ranked.flatMap(r => {
    const at = located.get(r.lapId);
    if (!at) return [];
    return [
      {
        sessionId: r.sessionId,
        lapId: r.lapId,
        lapIndex: at.lap.lapIndex,
        startedAt:
          r.sessionId === current.id ? null : at.source.session.startedAt,
        sessionType: at.source.session.sessionType,
        timeS: r.timeS,
        deltaS: target.timeS == null ? null : r.timeS - target.timeS,
        match: r.match,
      },
    ];
  });
}

const SESSION_WORD = {R: 'Race', Q: 'Qualifying', P: 'Practice'} as const;
/** "L12 · 25 Sep · Race · 1:21.234 · +0.412 s". */
export function candidateLine(c: Candidate): string {
  return [
    `L${c.lapIndex}`,
    c.startedAt ? formatDay(c.startedAt) : 'this session',
    SESSION_WORD[c.sessionType as keyof typeof SESSION_WORD] ?? c.sessionType,
    formatLapTime(c.timeS),
    c.deltaS == null ? null : `${formatGap(c.deltaS, 3)} s`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** What the candidate has in common with the lap, in the ranking's order; nothing it lacks. */
export function matchText(m: RefMatch): string {
  const has = [
    m.sameCar && 'same car',
    m.sameSession && 'same session type',
    m.fuelBand && 'load in band',
    m.tyresKept && 'tyres kept',
    m.clean && 'clean air',
  ].filter(Boolean);
  return has.length > 0 ? has.join(' · ') : 'no match on the ranking keys';
}
