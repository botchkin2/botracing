// Consistency over any set of laps. The uploader (tools/sessions/analyze.mjs)
// and the app both import this file, so the precomputed session numbers and a
// selection made on the phone always agree.
//
// A lap time is three things added together:
//   expected pace   what the car does on this lap of the stint (fuel burning
//                   off, tyres wearing). Fitted per stint as one trend.
//   scatter         what the driver adds or loses lap to lap.
//   incidents       one corner gone wrong, a local yellow, a slow lap all round.
// Consistency is the scatter, plus how often incidents happen and what they
// cost. One standard deviation over raw lap times mixes all three.
//
// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.

export interface CornerFacts {
  segTime: number;
  // Seconds of this corner driven with a local yellow in the car's sector.
  localYellowSec: number;
}

export interface LapFacts {
  id: string;
  lapNumber: number;
  stint: number;
  // Laps since the stint started, counting this one from 0.
  stintLap: number;
  lapTime: number;
  timed: boolean;
  partial: boolean;
  pitIn: boolean;
  pitOut: boolean;
  // The first lap of the session, from the grid or a rolling start.
  start: boolean;
  // First lap on a new set of tyres: cold whatever the temperature says.
  newTyres: boolean;
  offtrack: boolean;
  impactMax: number;
  // Mean tyre carcass temperature over the lap, all four tyres. Null if the
  // sim does not report it.
  tyreCarcassC: number | null;
  // Seconds of this lap under a full-course yellow.
  courseYellowSec: number;
  corners: CornerFacts[] | null;
}

export interface Thresholds {
  coldTyreC: number;
  farOffPace: number;
  slowLapZ: number;
  slowLapMinSec: number;
  cornerZ: number;
  cornerMinSec: number;
  mistakeShare: number;
  bigMistakeSec: number;
  yellowSec: number;
  trendKeep: number;
  cornerSumSec: number;
}

export const defaultThresholds: Thresholds = {
  // A lap is on cold tyres when the carcass is this far below the session's
  // normal running temperature.
  coldTyreC: 8,
  // Safety net only: a lap this far off the median is not racing pace.
  farOffPace: 1.07,
  // A lap is slow when its residual is past this many robust sigmas...
  slowLapZ: 2,
  // ...and at least this many seconds.
  slowLapMinSec: 0.2,
  // A corner went wrong when it is past this many of its own robust sigmas...
  cornerZ: 3,
  // ...and lost at least this much.
  cornerMinSec: 0.1,
  // One corner holds at least this share of the lap's loss: a mistake.
  mistakeShare: 0.4,
  // One corner losing this much is a mistake even if the lap was not slow.
  bigMistakeSec: 0.3,
  // Tag a corner event as under local yellow past this many seconds. Only a
  // tag: across 70 sessions, corners under local yellow lost time about as
  // often as green ones (22% vs 20% lost more than 0.1 s).
  yellowSec: 0.5,
  // Keep a stint's pace trend only if it shrinks the spread below this share.
  trendKeep: 0.9,
  // A lap's corners must add up to its lap time within this many seconds.
  cornerSumSec: 1,
};

export type ExcludeReason =
  | 'partial'
  | 'untimed'
  | 'pit-in'
  | 'pit-out'
  | 'start'
  | 'course-yellow'
  | 'cold-tyres'
  | 'far-off-pace';

export type LapKind =
  | 'normal'
  | 'mistake'
  | 'spread'
  | 'slow';

export interface CornerEvent {
  corner: number;
  seconds: number;
  z: number;
  underYellow: boolean;
}

export interface LapResult {
  id: string;
  lapNumber: number;
  stint: number;
  expected: number;
  residual: number;
  kind: LapKind;
  // The corner that holds the loss, 1-based, for a mistake.
  corner: number | null;
  // Time the incident cost, seconds.
  cost: number;
  // Every corner well off its own normal, both slow and fast.
  events: CornerEvent[];
  cornerDelta: number[] | null;
}

export interface CornerResult {
  n: number;
  medianSec: number;
  spreadSec: number;
  mistakes: number;
  mistakeCost: number;
  onTheTable: number;
}

export interface StintResult {
  n: number;
  laps: number;
  trendPerLap: number;
  medianLapTime: number | null;
}

export interface Consistency {
  laps: LapResult[];
  corners: CornerResult[];
  stints: StintResult[];
  summary: {
    laps: number;
    rawSpread: number | null;
    scatter: number | null;
    withinHalfSecond: number;
    mistakes: number;
    mistakeCost: number;
    spreadLaps: number;
    spreadCost: number;
    onTheTable: number;
  };
  verdict: string;
}

// Which laps are "normal racing": decided by conditions, never by how the
// lap went. Mistakes and off-tracks stay in, because they are the point.
export function normalRacing(
  laps: LapFacts[],
  t: Thresholds = defaultThresholds,
): Map<string, ExcludeReason[]> {
  const out = new Map<string, ExcludeReason[]>();
  const running = laps.filter(
    l => l.timed && !l.partial && !l.pitIn && !l.pitOut,
  );
  const temps = running
    .map(l => l.tyreCarcassC)
    .filter((v): v is number => v != null);
  const warm = temps.length >= 4 ? quantile(temps, 0.75) : null;
  for (const lap of laps) {
    const reasons: ExcludeReason[] = [];
    if (lap.partial) reasons.push('partial');
    if (!lap.timed) reasons.push('untimed');
    if (lap.pitIn) reasons.push('pit-in');
    if (lap.pitOut) reasons.push('pit-out');
    if (lap.start) reasons.push('start');
    if (lap.courseYellowSec > 1) reasons.push('course-yellow');
    if (lap.newTyres) {
      reasons.push('cold-tyres');
    } else if (
      warm != null &&
      lap.tyreCarcassC != null &&
      lap.tyreCarcassC < warm - t.coldTyreC
    ) {
      reasons.push('cold-tyres');
    }
    out.set(lap.id, reasons);
  }
  const pace = median(
    laps.filter(l => out.get(l.id)!.length === 0).map(l => l.lapTime),
  );
  if (pace != null) {
    for (const lap of laps) {
      const reasons = out.get(lap.id)!;
      if (reasons.length === 0 && lap.lapTime > pace * t.farOffPace) {
        reasons.push('far-off-pace');
      }
    }
  }
  return out;
}

// Analyze exactly the laps given. The caller picks them: normalRacing() for
// the default view, or whatever the driver selected.
export function analyzeConsistency(
  selected: LapFacts[],
  t: Thresholds = defaultThresholds,
): Consistency {
  const laps = [...selected].sort(
    (a, b) => a.stint - b.stint || a.stintLap - b.stintLap,
  );

  // Pace trend per stint: a robust straight line through lap time against
  // laps into the stint. Fuel, tyre wear and track evolution all move with
  // the lap count, so they are one trend here, not separate effects.
  const stints: StintResult[] = [];
  const expected = new Map<string, number>();
  for (const n of unique(laps.map(l => l.stint))) {
    const own = laps.filter(l => l.stint === n);
    const xs = own.map(l => l.stintLap);
    const ys = own.map(l => l.lapTime);
    let slope =
      own.length >= 6 && Math.max(...xs) - Math.min(...xs) >= 5
        ? theilSen(xs, ys)
        : 0;
    // Keep the trend only if it explains something: on a short, noisy stint
    // a fitted slope is noise that looks confident.
    const flat = robustSigma(ys) ?? 0;
    const fitted = robustSigma(ys.map((y, i) => y - slope * xs[i])) ?? 0;
    if (fitted > flat * t.trendKeep) slope = 0;
    const intercept = median(ys.map((y, i) => y - slope * xs[i])) ?? 0;
    own.forEach(l => expected.set(l.id, intercept + slope * l.stintLap));
    stints.push({
      n,
      laps: own.length,
      trendPerLap: round(slope, 3) ?? 0,
      medianLapTime: round(median(ys), 3),
    });
  }
  const residual = (l: LapFacts) => l.lapTime - expected.get(l.id)!;
  const lapSigma = robustSigma(laps.map(residual)) ?? 0;

  // Corner deltas: each corner's expected time is its usual share of the
  // lap's expected time, so the stint trend is spread over the corners.
  // A lap whose corners do not add up to its lap time was cut up wrong (a
  // start from the grid, a reset): leave it out of the corner view.
  const nc = mode(
    laps.filter(l => l.corners).map(l => l.corners!.length),
  );
  const withCorners = laps.filter(
    l =>
      l.corners &&
      l.corners.length === nc &&
      Math.abs(sum(l.corners.map(c => c.segTime)) - l.lapTime) <= t.cornerSumSec,
  );
  const share = range(nc).map(
    k =>
      median(
        withCorners.map(l => l.corners![k].segTime / expected.get(l.id)!),
      ) ?? 0,
  );
  const delta = new Map<string, number[]>();
  for (const l of withCorners) {
    const e = expected.get(l.id)!;
    delta.set(
      l.id,
      l.corners!.map((c, k) => c.segTime - share[k] * e),
    );
  }
  // Center each corner on its median, then measure its own spread.
  const center = range(nc).map(
    k => median(withCorners.map(l => delta.get(l.id)![k])) ?? 0,
  );
  for (const d of delta.values()) for (let k = 0; k < nc; k++) d[k] -= center[k];
  const sigma = range(nc).map(k =>
    Math.max(0.02, robustSigma(withCorners.map(l => delta.get(l.id)![k])) ?? 0),
  );

  const results: LapResult[] = laps.map(l => {
    const r = residual(l);
    const d = delta.get(l.id) ?? null;
    const events: CornerEvent[] = [];
    let kind: LapKind = 'normal';
    let corner: number | null = null;
    let cost = 0;
    if (d) {
      for (let k = 0; k < nc; k++) {
        const z = d[k] / sigma[k];
        if (Math.abs(z) >= t.cornerZ && Math.abs(d[k]) >= t.cornerMinSec) {
          events.push({
            corner: k + 1,
            seconds: round(d[k], 3)!,
            z: round(z, 1)!,
            underYellow: l.corners![k].localYellowSec >= t.yellowSec,
          });
        }
      }
    }
    // A mistake is one corner far past its own normal. On a slow lap it must
    // hold most of what the lap lost (else the lap was slow everywhere). On a
    // lap that made the time back elsewhere, it must be a big loss on its own.
    let worst = -1;
    let worstLoss = 0;
    if (d) {
      for (let k = 0; k < nc; k++) {
        // Segments run brake to brake (src/analysis/corners.ts), so a slow
        // exit is already inside the corner's own time.
        if (d[k] / sigma[k] < t.cornerZ || d[k] < t.cornerMinSec) continue;
        if (d[k] > worstLoss) {
          worst = k;
          worstLoss = d[k];
        }
      }
    }
    const lost = d ? sum(d.map(v => Math.max(0, v))) : 0;
    const slow = r >= Math.max(t.slowLapZ * lapSigma, t.slowLapMinSec);
    if (
      worst >= 0 &&
      (slow ? worstLoss >= t.mistakeShare * lost : worstLoss >= t.bigMistakeSec)
    ) {
      kind = 'mistake';
      corner = worst + 1;
      cost = worstLoss;
    } else if (slow) {
      const slowCorners = d
        ? d.filter((v, k) => v > 0 && v / sigma[k] >= 1).length
        : 0;
      kind = d && slowCorners >= Math.ceil(nc / 2) ? 'spread' : 'slow';
      cost = r;
    }
    return {
      id: l.id,
      lapNumber: l.lapNumber,
      stint: l.stint,
      expected: round(expected.get(l.id)!, 3)!,
      residual: round(r, 3)!,
      kind,
      corner,
      cost: round(cost, 3)!,
      events,
      cornerDelta: d ? d.map(v => round(v, 3)!) : null,
    };
  });

  const corners: CornerResult[] = range(nc).map(k => {
    const values = withCorners.map(l => delta.get(l.id)![k]);
    const own = results.filter(r => r.kind === 'mistake' && r.corner === k + 1);
    return {
      n: k + 1,
      medianSec: round(
        median(withCorners.map(l => l.corners![k].segTime)),
        3,
      )!,
      spreadSec: round(sigma[k], 3)!,
      mistakes: own.length,
      mistakeCost: round(sum(own.map(r => r.cost)), 2)!,
      // Repeatable pace, not the one lucky pass: median minus the 25th
      // percentile, both after the stint trend is taken out.
      onTheTable: round(
        (median(values) ?? 0) - (quantile(values, 0.25) ?? 0),
        3,
      )!,
    };
  });

  const normal = results.filter(r => r.kind === 'normal');
  const of = (kind: LapKind) => results.filter(r => r.kind === kind);
  const lapTimes = laps.map(l => l.lapTime);
  const pace = median(lapTimes);
  const summary = {
    laps: laps.length,
    rawSpread: round(stdev(lapTimes), 3),
    scatter: round(stdev(normal.map(r => r.residual)), 3),
    withinHalfSecond:
      pace == null ? 0 : lapTimes.filter(v => Math.abs(v - pace) <= 0.5).length,
    mistakes: of('mistake').length,
    mistakeCost: round(sum(of('mistake').map(r => r.cost)), 2)!,
    spreadLaps: of('spread').length,
    spreadCost: round(sum(of('spread').map(r => r.cost)), 2)!,
    onTheTable: round(sum(corners.map(c => c.onTheTable)), 2)!,
  };
  return {
    laps: results,
    corners,
    stints,
    summary,
    verdict: verdict(summary, stints, corners),
  };
}

function verdict(
  s: Consistency['summary'],
  stints: StintResult[],
  corners: CornerResult[],
): string {
  if (s.laps < 3) return `${s.laps} laps. Not enough to judge consistency.`;
  const parts = [`${s.laps} laps.`];
  if (s.scatter != null) {
    parts.push(`Lap to lap you vary ${s.scatter.toFixed(2)} s once the pace trend is taken out.`);
  }
  const trend = stints.filter(st => Math.abs(st.trendPerLap) >= 0.01);
  if (trend.length) {
    parts.push(
      `Pace trend ${trend
        .map(st => `${fmtSigned(st.trendPerLap)} s/lap in stint ${st.n}`)
        .join(', ')}.`,
    );
  }
  if (s.mistakes) {
    parts.push(
      `${s.mistakes} ${s.mistakes === 1 ? 'mistake' : 'mistakes'} cost ${s.mistakeCost.toFixed(1)} s.`,
    );
  }
  if (s.spreadLaps) {
    parts.push(
      `${s.spreadLaps} ${s.spreadLaps === 1 ? 'lap was' : 'laps were'} slow everywhere (traffic?), ${s.spreadCost.toFixed(1)} s.`,
    );
  }
  const work = [...corners]
    .filter(c => c.mistakes > 0 || c.onTheTable >= 0.05)
    .sort((a, b) => b.mistakeCost + b.onTheTable - (a.mistakeCost + a.onTheTable))
    .slice(0, 3);
  if (work.length) {
    parts.push(
      `Work on ${work
        .map(
          c =>
            `corner ${c.n} (${c.mistakes ? `${c.mistakes} ${c.mistakes === 1 ? 'mistake' : 'mistakes'}, ` : ''}${c.onTheTable.toFixed(2)} s on the table)`,
        )
        .join(', ')}.`,
    );
  } else {
    parts.push('No corner stands out.');
  }
  return parts.join(' ');
}

function fmtSigned(v: number): string {
  return (v > 0 ? '+' : '') + v.toFixed(3);
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function theilSen(xs: number[], ys: number[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      if (xs[j] !== xs[i]) slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
    }
  }
  return median(slopes) ?? 0;
}

function robustSigma(values: number[]): number | null {
  const m = median(values);
  if (m == null) return null;
  return 1.4826 * (median(values.map(v => Math.abs(v - m))) ?? 0);
}

function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

function quantile(values: number[], q: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function stdev(values: number[]): number | null {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return null;
  const mean = sum(v) / v.length;
  return Math.sqrt(sum(v.map(x => (x - mean) ** 2)) / (v.length - 1));
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function unique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function range(n: number): number[] {
  return Array.from({length: n}, (_, i) => i);
}

function round(value: number | null, digits: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}
