import {sittings} from '@/src/analysis/sitting';
import {median, percentile} from '@/src/analysis/setStats';
import type {PlanSession} from '@/src/data/sessions/planBlock';
import {formatDayMonth, formatLapTime} from '@/src/design/format';

// Progression on one track in one car (pit-wall thread 88, S5, chord #6056):
// each set's median lap and its p10 to p90 over time, one lane per session
// type, never mixed (a practice's scatter and a race's answer different
// questions). A practice or qualifying set is a sitting (analysis/sitting.ts,
// the day set's 3 h rule), a session alone is its own set, and a race is
// always its own. Pure: the combo's /plan sessions in, lanes out.
//
// A dot's laps are each session's opening set as the uploader stored it
// (`paceSet`, analysis/paceSet.ts): a single session's dot is exactly what
// its Session screen opens on. A sitting's dot is the union of its members'
// own sets, so it can sit a hair off the day view (#666), which also judges a
// short member's laps on the pooled day from section times this read does not
// carry (gauge #6061, chord #6062).

/** Fewest laps for a set's spread to mean anything: under it the dot is hollow and has no bar. */
export const MIN_BAR_LAPS = 3;

export type ProgressionType = 'P' | 'Q' | 'R';

export type ProgressionDot = {
  /** Its sessions, in start order: one for a race or a session alone. */
  ids: string[];
  /** The first session's start. */
  startedAt: string;
  laps: number;
  medianS: number;
  /** Null under MIN_BAR_LAPS laps: a hollow dot. */
  p10S: number | null;
  p90S: number | null;
};

export type ProgressionLane = {type: ProgressionType; dots: ProgressionDot[]};

const TYPES: readonly ProgressionType[] = ['P', 'Q', 'R'];

type Row = PlanSession & {lapTimesS: number[]};

function dotOf(rows: readonly Row[]): ProgressionDot | null {
  const times = rows.flatMap(r => r.lapTimesS);
  const m = median(times);
  if (m == null) return null;
  const bar = times.length >= MIN_BAR_LAPS;
  return {
    ids: rows.map(r => r.id),
    startedAt: rows[0].startedAt,
    laps: times.length,
    medianS: m,
    p10S: bar ? percentile(times, 0.1) : null,
    p90S: bar ? percentile(times, 0.9) : null,
  };
}

/**
 * The lanes he has (P, Q, R, in that order; none without a set), each with its
 * dots oldest first. A session with no stored set (analysed before it, or
 * under two laps that count) is left out, and does not join a sitting.
 */
export function progressionLanes(
  sessions: readonly PlanSession[],
): ProgressionLane[] {
  // /plan is one track and car: sittings() keys on them, so they are constant here.
  const rows = sessions.flatMap(s =>
    s.paceSetS && s.paceSetS.length > 0
      ? [{...s, lapTimesS: s.paceSetS, trackId: '', carModel: ''}]
      : [],
  );
  const lanes: ProgressionLane[] = [];
  for (const type of TYPES) {
    const ofType = rows.filter(r => r.sessionType === type);
    const grouped = sittings(ofType);
    const inSitting = new Set(grouped.flat().map(r => r.id));
    const dots = [
      ...grouped,
      ...ofType.filter(r => !inSitting.has(r.id)).map(r => [r]),
    ]
      .flatMap(set => dotOf(set) ?? [])
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    if (dots.length > 0) lanes.push({type, dots});
  }
  return lanes;
}

/** The line a tapped dot shows: "Oct 15 · 3 sessions · 31 laps · 2:01.490 · p10-p90 0.62 s". */
export function dotLine(dot: ProgressionDot): string {
  return [
    formatDayMonth(dot.startedAt),
    dot.ids.length > 1 ? `${dot.ids.length} sessions` : null,
    `${dot.laps} ${dot.laps === 1 ? 'lap' : 'laps'}`,
    formatLapTime(dot.medianS),
    dot.p10S != null && dot.p90S != null
      ? `p10-p90 ${(dot.p90S - dot.p10S).toFixed(2)} s`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Where a dot sits in its lane: x over the card's shared dates, y over the lane's own range (faster up). */
export type PlacedDot = {dot: ProgressionDot; x: number; y: number; y10: number | null; y90: number | null};

/**
 * Every lane's dots placed in a `width` by `laneH` box with `pad` kept clear
 * at each edge. The dates are one axis for all lanes, so a practice and the
 * race after it line up; each lane's times are its own scale (a practice's
 * spread would flatten a race's).
 */
export function placeLanes(
  lanes: readonly ProgressionLane[],
  width: number,
  laneH: number,
  pad: number,
): {type: ProgressionType; dots: PlacedDot[]}[] {
  const all = lanes.flatMap(l => l.dots.map(d => Date.parse(d.startedAt)));
  const t0 = Math.min(...all);
  const span = Math.max(...all) - t0;
  const xOf = (iso: string) =>
    span > 0
      ? pad + ((Date.parse(iso) - t0) / span) * (width - 2 * pad)
      : width / 2;
  return lanes.map(lane => {
    const ends = lane.dots.flatMap(d => [d.p10S ?? d.medianS, d.p90S ?? d.medianS]);
    const lo = Math.min(...ends);
    const range = Math.max(...ends) - lo;
    const yOf = (s: number) =>
      range > 0 ? pad + ((s - lo) / range) * (laneH - 2 * pad) : laneH / 2;
    return {
      type: lane.type,
      dots: lane.dots.map(dot => ({
        dot,
        x: xOf(dot.startedAt),
        y: yOf(dot.medianS),
        y10: dot.p10S != null ? yOf(dot.p10S) : null,
        y90: dot.p90S != null ? yOf(dot.p90S) : null,
      })),
    };
  });
}

/** The dot nearest a tap at x in a lane. */
export function nearestDot(dots: readonly PlacedDot[], x: number): PlacedDot | null {
  let best: PlacedDot | null = null;
  for (const d of dots)
    if (!best || Math.abs(d.x - x) < Math.abs(best.x - x)) best = d;
  return best;
}
