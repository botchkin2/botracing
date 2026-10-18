// Which laps are the driver's repeatable pace and which are events: the rule
// behind the default selection (pit-wall decisions/lap/2026-10-12-default-
// selection-outliers.md; the study is thread 1 #4886 to #4917, the judge is
// "(f)": kingpin's design, gasket's simulation, Botkin's pick).
//
// A lap is an event when its time sits more than EVENT_SIGMAS robust sigmas
// (and at least EVENT_GUARD_S) above its stint's pace curve. The curve is
// built from the sections, so a mistake in one or two of them cannot bend it:
//   1. each section has a base, its median over the session's laps;
//   2. a lap's pace factor is the median of its sections over their bases
//      (weighted by the base), so fuel, tyres and rubber, which move every
//      section, move it, and a big loss in one or two sections does not;
//   3. a stint's curve is a running median of 5 laps of that factor (Tukey's
//      smoother and end rule): a curve, not a line, so a tyre knee is followed
//      and a slower patch of 3+ laps is part of the curve, not a run of events;
//   4. the residual is the lap time minus the curve; sigma is 1.4826 x MAD of
//      the session's residuals (the Hampel identifier), corrected for the few
//      laps it is taken from (smallSampleFactor). A stint under MIN_CURVE_LAPS
//      laps has no curve to be judged against: its laps are compared with the
//      session's pace, and the limit is still made from the residuals above.
// Laps with no sections (or sections that do not line up) use the lap time as
// the factor: the same curve and the same test. No straight line anywhere.
// Neither sections nor recorded events (off-track, yellow, impact) decide: a lap
// is an event by its time alone. Pure; Node runs it as is (the uploader), so relative imports carry
// the .ts extension.
import {median} from './setStats.ts';

/** Under this many candidate laps a session has no pace to judge: nothing is an event (with two or three laps no rule can tell a slow lap from a different pace). */
export const MIN_EVENT_LAPS = 5;
/** Robust sigmas above the curve (Leys et al. 2013 ask for 2.5 by default; a corner's loss is skewed, so 3.5: gasket's simulation, #4876/#4891). */
export const EVENT_SIGMAS = 3.5;
/**
 * The small-sample correction for the MAD (Croux & Rousseeuw 1992, "Time-
 * efficient algorithms for two highly robust estimators of scale"): a MAD from
 * a few laps reads the sigma low, so the limit is multiplied by this. A table
 * to 9 laps, n / (n - 0.8) from 10.
 */
const SMALL_SAMPLE = [
  NaN,
  NaN,
  1.196,
  1.495,
  1.363,
  1.206,
  1.2,
  1.14,
  1.129,
  1.107,
];
export const smallSampleFactor = (n: number) =>
  n >= 10 ? n / (n - 0.8) : SMALL_SAMPLE[n] ?? 1;

/** A guard only: a driver whose laps are near identical would otherwise flag 0.25 s laps. */
export const EVENT_GUARD_S = 0.3;
/** Laps in the running median that makes a stint's curve. */
const SMOOTH_LAPS = 5;
/**
 * A lap needs a curve to be judged against. A stint with fewer candidate laps
 * than this is judged against the session's pace, and the limit stays the
 * session's (pit-wall thread 75 #5876: judging a short stint against itself
 * is a residual of 0, so a slow lap alone in a stint could never be slow).
 */
export const MIN_CURVE_LAPS = 3;

export interface PaceLap {
  id: string;
  stint: number;
  /** Laps into the stint: orders the laps; only the order is used. */
  stintLap: number;
  lapTime: number;
  /** Seconds in each section, the start straight first; they add up to the lap time. Null when the lap has none. */
  sections: number[] | null;
}

export interface PaceEvent {
  id: string;
  /** Seconds above the stint's pace curve. */
  residualS: number;
  /** An event is a residual over this: EVENT_SIGMAS x the session's sigma, at least EVENT_GUARD_S. */
  limitS: number;
}

const finite = (xs: readonly number[]) => xs.filter(Number.isFinite);

/** 1.4826 x MAD: the normal sigma a median absolute deviation stands for. */
function robustSigma(xs: readonly number[]): number {
  const m = median(xs);
  if (m == null) return 0;
  return 1.4826 * (median(xs.map(x => Math.abs(x - m))) ?? 0);
}

/** The median of `xs` where each carries a weight (the first value at which half the weight is reached). */
function weightedMedian(xs: readonly number[], ws: readonly number[]): number {
  const v = xs
    .map((x, i): [number, number] => [x, ws[i]])
    .filter(([x, w]) => Number.isFinite(x) && w > 0)
    .sort((a, b) => a[0] - b[0]);
  const total = v.reduce((t, [, w]) => t + w, 0);
  let acc = 0;
  for (const [x, w] of v) {
    acc += w;
    if (acc >= total / 2) return x;
  }
  return NaN;
}

const med = (xs: readonly number[]) => median(xs) ?? NaN;

/**
 * A stint's pace curve: a running median of 5 laps (Tukey), with his end-point
 * rule at both ends (the end value, the next smoothed one, and the straight-line
 * extrapolation of the two after it). A median follows a linear fade exactly and
 * keeps a run of more than 2 laps as part of the curve. A stint under 5 laps is
 * its median.
 */
export function smoothPace(f: readonly number[]): number[] {
  const n = f.length;
  if (n < SMOOTH_LAPS) return f.map(() => med(f));
  const h = SMOOTH_LAPS >> 1;
  const rm = f.map((_, i) =>
    i < h || i >= n - h ? NaN : med(f.slice(i - h, i + h + 1)),
  );
  // Ends: grow the window one lap at a time toward the edge (median of 3 at
  // distance 1), then Tukey's rule at the very end.
  for (let d = h - 1; d >= 1; d--) {
    rm[d] = med(f.slice(0, 2 * d + 1));
    rm[n - 1 - d] = med(f.slice(n - 1 - 2 * d));
  }
  rm[0] = med([f[0], rm[1], 3 * rm[1] - 2 * rm[2]]);
  rm[n - 1] = med([f[n - 1], rm[n - 2], 3 * rm[n - 2] - 2 * rm[n - 3]]);
  return rm;
}

/**
 * A lap's section times as `PaceLap.sections` wants them: the start straight
 * then the sections, all present and positive (they add up to the lap time),
 * else null. The uploader and the app both build `sections` here.
 */
export function sectionTimesOf(
  startStraightS: number | null | undefined,
  sectionS: readonly (number | null | undefined)[],
): number[] | null {
  const parts = [startStraightS, ...sectionS];
  return parts.length >= 2 && parts.every(t => t != null && t > 0)
    ? (parts as number[])
    : null;
}

/** The session's sections as every lap shares them: a count of 2 or more, the same on every lap. */
function sectionCount(laps: readonly PaceLap[]): number {
  const n = laps[0]?.sections?.length ?? 0;
  return n >= 2 && laps.every(l => l.sections?.length === n) ? n : 0;
}

/**
 * The events among a session's laps, in the order given. Laps are the
 * candidates: timed, whole, not in or out of the pits. Fewer than
 * MIN_EVENT_LAPS drops nothing.
 */
export function paceEvents(laps: readonly PaceLap[]): PaceEvent[] {
  if (laps.length < MIN_EVENT_LAPS) return [];
  const n = sectionCount(laps);
  const base: number[] = [];
  let total = 0;
  if (n > 0) {
    for (let s = 0; s < n; s++)
      base.push(med(finite(laps.map(l => (l.sections as number[])[s]))));
    total = base.reduce((t, b) => t + b, 0);
  }
  // A lap's pace factor, and what the lap time is against the curve.
  const factor = new Map<string, number>();
  for (const l of laps)
    factor.set(
      l.id,
      n > 0
        ? weightedMedian(
            (l.sections as number[]).map((t, s) => t / base[s]),
            base,
          )
        : l.lapTime,
    );
  const scale = n > 0 ? total : 1;
  // The residual that makes the session's limit, and the one a lap is
  // compared to it with: the same except in a stint too short for a curve.
  const residual = new Map<string, number>();
  const judged = new Map<string, number>();
  const sessionPace = med([...factor.values()]);
  const stints = [...new Set(laps.map(l => l.stint))];
  for (const st of stints) {
    const own = laps
      .filter(l => l.stint === st)
      .sort((a, b) => a.stintLap - b.stintLap);
    const curve = smoothPace(own.map(l => factor.get(l.id) as number));
    own.forEach((l, i) => {
      const r = l.lapTime - scale * curve[i];
      residual.set(l.id, r);
      judged.set(
        l.id,
        own.length < MIN_CURVE_LAPS ? l.lapTime - scale * sessionPace : r,
      );
    });
  }
  const limitS = Math.max(
    EVENT_SIGMAS *
      smallSampleFactor(residual.size) *
      robustSigma([...residual.values()]),
    EVENT_GUARD_S,
  );
  const events: PaceEvent[] = [];
  for (const l of laps) {
    const r = judged.get(l.id) as number;
    if (!(r > limitS)) continue;
    events.push({id: l.id, residualS: r, limitS});
  }
  return events;
}

// ---- slow laps: the one function that says which laps are slow ---------------

/**
 * The slow laps among a session's candidate laps (timed, whole, no pit lane):
 * the single definition the uploader stores as `reasons: ['slow']` and the
 * app's default selection leaves unticked. One rule for every session size:
 * a session with fewer than MIN_EVENT_LAPS candidate laps has no slow lap.
 */
export function slowLapIds(laps: readonly PaceLap[]): Set<string> {
  return new Set(paceEvents(laps).map(e => e.id));
}
