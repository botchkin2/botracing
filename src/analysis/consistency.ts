// Consistency over any set of laps. The uploader (tools/sessions/analyze.mjs)
// and the app both import this file, so the precomputed session numbers and a
// selection made on the phone always agree.
//
// A lap time is expected pace plus what the driver did:
//   expected pace   what the car does on this lap of the stint (fuel burning
//                   off, tyres wearing, the track rubbering in). One robust
//                   trend per stint.
//   residual        the lap time minus expected pace.
// Consistency is the scatter of the residuals on ordinary laps, plus, for
// each lap well off pace, how much it lost and which corners it lost it in.
// Laps are not forced into "mistake" or "slow everywhere": with real corners
// most bad laps lose time in two or three places.
//
// Everything here is data to inspect, not advice. Every threshold is in
// Thresholds and echoed in the result, and any lap can be put back in or
// taken out by passing a different selection.
//
// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.

export interface CornerFacts {
  // Entry to next entry (src/analysis/corners.ts), so the exit is included.
  segTime: number;
  // Seconds of this corner driven with a local yellow in the car's sector.
  localYellowSec: number;
  offTrackSec?: number;
  minSpeedKmh?: number | null;
  brakeAtM?: number | null;
  fullThrottleAtM?: number | null;
  // The last corner of a lap with no lap straight after it: its exit is
  // estimated from this lap's own start.
  approximate?: boolean;
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
  offTrackSec: number;
  impactMax: number;
  // Mean tyre carcass temperature over the lap, all four tyres. Null if the
  // sim does not report it.
  tyreCarcassC: number | null;
  // Seconds of this lap under a full-course yellow.
  courseYellowSec: number;
  // Tyre compound fitted (the sim's own code, front/rear), and the highest
  // racing-line wetness during the lap in percent. Null if not recorded.
  compound?: string | null;
  wetness?: number | null;
  corners: CornerFacts[] | null;
}

export interface Thresholds {
  coldTyreC: number;
  farOffPace: number;
  offPaceZ: number;
  offPaceMinSec: number;
  lossZ: number;
  lossCover: number;
  mistakeZ: number;
  mistakeSec: number;
  yellowSec: number;
  trendSigmas: number;
  incidentOffSec: number;
  damageSec: number;
  wetPct: number;
  cleanOffSec: number;
}

export const defaultThresholds: Thresholds = {
  // A lap is on cold tyres when the carcass is this far below the session's
  // normal running temperature.
  coldTyreC: 8,
  // Safety net only: a lap this far off the median is not racing pace.
  farOffPace: 1.07,
  // A lap is off pace when its residual is past this many robust sigmas...
  offPaceZ: 2,
  // ...and at least this many seconds.
  offPaceMinSec: 0.2,
  // Name a corner as where the time went only past this many of its own
  // robust sigmas. 12 corners at 2 sigma would name one innocent corner on
  // every other lap by chance.
  lossZ: 2.5,
  // Stop naming corners once they cover this share of what the lap lost.
  lossCover: 0.7,
  // A mistake: one corner past this many sigmas...
  mistakeZ: 3,
  // ...that lost at least this much on its own.
  mistakeSec: 0.3,
  // Tag a corner as under local yellow past this many seconds. Only a tag:
  // across 70 sessions, corners under local yellow lost time about as often
  // as green ones (22% vs 20% lost more than 0.1 s).
  yellowSec: 0.5,
  // Keep a stint's pace trend only if it moves the pace across the stint by
  // at least this many robust sigmas of the scatter left around it.
  trendSigmas: 2,
  // An incident: this long off track in one lap (or a lap far off pace).
  incidentOffSec: 1,
  // After an incident, the laps up to the next one or the end of the stint
  // count as possibly damaged when their median is this much slower than
  // the laps with no incident before them. LMU records no damage state, so
  // this is inferred from pace, and says so.
  damageSec: 0.3,
  // A lap is in wet conditions from this much racing-line wetness (percent).
  wetPct: 5,
  // A pass through a section with this much off-track time does not count
  // as that section's best.
  cleanOffSec: 0.2,
};

// Laps are only compared with laps driven in the same conditions: the same
// tyre compound, and the same side of the wet threshold. A rain shower and a
// change to wets is not the driver getting slower.
export function conditionsOf(
  lap: LapFacts,
  t: Thresholds = defaultThresholds,
): string {
  const wet = (lap.wetness ?? 0) >= t.wetPct ? 'wet' : 'dry';
  return `${lap.compound ?? '-'} ${wet}`;
}

export type ExcludeReason =
  | 'partial'
  | 'untimed'
  | 'pit-in'
  | 'pit-out'
  | 'start'
  | 'course-yellow'
  | 'cold-tyres'
  | 'far-off-pace'
  | 'damage';

export type LossTag = 'off-track' | 'local-yellow';

export interface CornerLoss {
  corner: number;
  seconds: number;
  z: number;
  mistake: boolean;
  tags: LossTag[];
}

export interface LapResult {
  id: string;
  lapNumber: number;
  stint: number;
  expected: number;
  // Lap time minus expected pace. Positive is slower.
  residual: number;
  offPace: boolean;
  // Where the time went, largest first. Filled for off-pace laps and for any
  // lap with a mistake.
  losses: CornerLoss[];
  // Per corner, seconds against that corner's usual share of expected pace.
  cornerDelta: number[] | null;
}

export interface CornerSplit {
  // Median of the slow third minus median of the fast third.
  seconds: number;
  brakeAtM: number | null;
  minSpeedKmh: number | null;
  fullThrottleAtM: number | null;
}

export interface CornerResult {
  n: number;
  medianSec: number;
  // Robust sigma of the corner's time, trend removed.
  spreadSec: number;
  // Time lost against this corner's repeatable pace (25th percentile),
  // summed over the laps. This is what the track map colors by.
  lostSec: number;
  // How often this corner is named where an off-pace lap lost its time.
  named: number;
  mistakes: number;
  // Median minus 25th percentile: the gap to repeatable pace on a typical lap.
  onTheTable: number;
  // The fastest pass through this section on the selected laps, and the lap
  // it came from. A pass that left the track is skipped, but the rest of that
  // lap still counts for the other sections.
  bestSec: number | null;
  bestLap: number | null;
  // Fast passes against slow passes: where they split.
  split: CornerSplit | null;
}

export interface StintResult {
  n: number;
  laps: number;
  trendPerLap: number;
  medianLapTime: number | null;
}

export interface Summary {
  laps: number;
  rawSpread: number | null;
  // Spread of the residuals on laps that were not off pace.
  scatter: number | null;
  withinHalfSecond: number;
  offPaceLaps: number;
  offPaceSec: number;
  mistakes: number;
  mistakeSec: number;
  onTheTable: number;
  bestLap: number | null;
  // The sum of the best sections: a lap made of the fastest clean pass
  // through each section.
  optimalLap: number | null;
}

export interface Consistency {
  laps: LapResult[];
  corners: CornerResult[];
  stints: StintResult[];
  summary: Summary;
  // A plain-text entry point to the numbers above. States what happened;
  // never tells the driver what to do.
  overview: string;
  // The thresholds this result was computed with.
  thresholds: Thresholds;
}

// The evidence behind a possible-damage call, kept so it can be checked and
// overridden. Every stretch after an incident is listed, flagged or not.
export interface DamageCheck {
  incidentLapId: string;
  incidentLap: number;
  stint: number;
  lapIds: string[];
  laps: number[];
  // How much slower these laps ran than the reference laps: against the
  // stint's pace trend when the stint has reference laps of its own, else
  // raw lap times against the other stints.
  slowerSec: number;
  reference: 'same-stint' | 'other-stints';
  referenceLaps: number;
  flagged: boolean;
}

export interface Selection {
  reasons: Map<string, ExcludeReason[]>;
  damage: DamageCheck[];
}

// Which laps are "normal racing": decided by conditions, never by how the
// lap went. Mistakes and off-tracks stay in, because they are the point.
export function normalRacing(
  laps: LapFacts[],
  t: Thresholds = defaultThresholds,
): Map<string, ExcludeReason[]> {
  return selectNormalRacing(laps, t).reasons;
}

// normalRacing() with the evidence for each possible-damage call.
export function selectNormalRacing(
  laps: LapFacts[],
  t: Thresholds = defaultThresholds,
): Selection {
  const out = new Map<string, ExcludeReason[]>();
  const running = laps.filter(
    l => l.timed && !l.partial && !l.pitIn && !l.pitOut,
  );
  // Normal running temperature per compound: wets run cooler than slicks.
  const warmBy = new Map<string, number | null>();
  const warmFor = (lap: LapFacts) => {
    const key = lap.compound ?? '-';
    if (!warmBy.has(key)) {
      const temps = running
        .filter(l => (l.compound ?? '-') === key)
        .map(l => l.tyreCarcassC)
        .filter((v): v is number => v != null);
      warmBy.set(key, temps.length >= 4 ? quantile(temps, 0.75) : null);
    }
    return warmBy.get(key)!;
  };
  for (const lap of laps) {
    const warm = warmFor(lap);
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
  // Far off pace against laps in the same conditions.
  for (const key of new Set(laps.map(l => conditionsOf(l, t)))) {
    const group = laps.filter(l => conditionsOf(l, t) === key);
    const pace = median(
      group.filter(l => out.get(l.id)!.length === 0).map(l => l.lapTime),
    );
    if (pace == null) continue;
    for (const lap of group) {
      const reasons = out.get(lap.id)!;
      if (reasons.length === 0 && lap.lapTime > pace * t.farOffPace) {
        reasons.push('far-off-pace');
      }
    }
  }
  const damage = markDamage(laps, out, t);
  return {reasons: out, damage};
}

// Laps after a wreck until the stint ends (the pit stop is the chance to
// repair) or the next wreck. If they run slower than the laps with no
// incident before them, the car was probably damaged: a condition, not the
// driver's scatter.
//
// An off-track of incidentOffSec or more always starts a new stretch. A lap
// far off pace starts one only when the car is not already in one, so a
// damaged car's slow laps do not split their own stretch.
//
// Stretches are judged in order within each stint, against the stint's clear
// laps in the same conditions, compared on residuals to the stint's pace trend. A stretch that is not
// flagged rejoins the reference. Only a stint with fewer than 3 reference laps
// falls back to raw times from the other stints in the same conditions, and
// the evidence says so.
function markDamage(
  laps: LapFacts[],
  out: Map<string, ExcludeReason[]>,
  t: Thresholds,
): DamageCheck[] {
  const ordered = [...laps].sort(
    (a, b) => a.stint - b.stint || a.stintLap - b.stintLap,
  );
  const eligible = (l: LapFacts) => out.get(l.id)!.length === 0;
  const phases: {incident: LapFacts; laps: LapFacts[]}[] = [];
  let current: LapFacts[] | null = null;
  let stint = -1;
  for (const lap of ordered) {
    if (lap.stint !== stint) {
      stint = lap.stint;
      current = null;
    }
    const racing = lap.timed && !lap.pitIn && !lap.pitOut;
    const wreck = racing && lap.offTrackSec >= t.incidentOffSec;
    const far = racing && out.get(lap.id)!.includes('far-off-pace');
    if (wreck || (far && !current)) {
      current = [];
      phases.push({incident: lap, laps: current});
    } else if (current) {
      current.push(lap);
    }
  }
  // Laps still under suspicion: in a stretch not yet judged, or flagged.
  const suspect = new Set(phases.flatMap(ph => ph.laps).map(l => l.id));
  const reference = (keep: (l: LapFacts) => boolean) =>
    ordered.filter(l => eligible(l) && !suspect.has(l.id) && keep(l));
  const conditionsOfPhase = (own: LapFacts[]) =>
    mostCommon(own.map(l => conditionsOf(l, t)));
  const checks: DamageCheck[] = [];
  const judge = (
    phase: (typeof phases)[number],
    slower: number,
    kind: DamageCheck['reference'],
    refCount: number,
    own: LapFacts[],
  ) => {
    const flagged = slower >= t.damageSec;
    if (flagged) {
      for (const lap of own) out.get(lap.id)!.push('damage');
    } else {
      for (const lap of own) suspect.delete(lap.id);
    }
    checks.push({
      incidentLapId: phase.incident.id,
      incidentLap: phase.incident.lapNumber,
      stint: phase.incident.stint,
      lapIds: own.map(l => l.id),
      laps: own.map(l => l.lapNumber),
      slowerSec: round(slower, 3)!,
      reference: kind,
      referenceLaps: refCount,
      flagged,
    });
  };
  // First each stretch against its own stint, in order.
  const later: (typeof phases)[number][] = [];
  for (const phase of phases) {
    const own = phase.laps.filter(eligible);
    if (own.length < 2) {
      for (const lap of own) suspect.delete(lap.id);
      continue;
    }
    const cond = conditionsOfPhase(own);
    const ref = reference(
      l => l.stint === phase.incident.stint && conditionsOf(l, t) === cond,
    );
    if (ref.length < 3) {
      later.push(phase);
      continue;
    }
    const trend = fitTrend(
      ref.map(l => l.stintLap),
      ref.map(l => l.lapTime),
      t,
    );
    const residual = (l: LapFacts) =>
      l.lapTime - (trend.intercept + trend.slope * l.stintLap);
    judge(phase, median(own.map(residual))!, 'same-stint', ref.length, own);
  }
  // Then stints with too few clear laps, against the other stints.
  for (const phase of later) {
    const own = phase.laps.filter(eligible);
    const cond = conditionsOfPhase(own);
    const ref = reference(
      l => l.stint !== phase.incident.stint && conditionsOf(l, t) === cond,
    );
    if (ref.length < 3) {
      for (const lap of own) suspect.delete(lap.id);
      continue;
    }
    const slower =
      median(own.map(l => l.lapTime))! - median(ref.map(l => l.lapTime))!;
    judge(phase, slower, 'other-stints', ref.length, own);
  }
  return checks;
}

// A robust straight line through lap time against laps into the stint. The
// slope is kept only if it moves the pace across the stint by clearly more
// than the scatter left around it: on a short, noisy stint a fitted slope is
// noise that looks confident.
function fitTrend(
  xs: number[],
  ys: number[],
  t: Thresholds,
): {slope: number; intercept: number} {
  const range = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  let slope = xs.length >= 6 && range >= 5 ? theilSen(xs, ys) : 0;
  const fitted = robustSigma(ys.map((y, i) => y - slope * xs[i])) ?? 0;
  if (Math.abs(slope) * range < t.trendSigmas * fitted) slope = 0;
  const intercept = median(ys.map((y, i) => y - slope * xs[i])) ?? 0;
  return {slope, intercept};
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
    const ys = own.map(l => l.lapTime);
    const {slope, intercept} = fitTrend(
      own.map(l => l.stintLap),
      ys,
      t,
    );
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

  // The uploader only gives corner facts to laps whose distance starts at
  // the line and covers the mapped lap. Guard the shape here too.
  const nc = mode(laps.filter(l => l.corners).map(l => l.corners!.length));
  const withCorners = laps.filter(
    l =>
      l.corners &&
      l.corners.length === nc &&
      l.corners.every(c => c.segTime > 0),
  );

  // Corner deltas: each corner's expected time is its usual share of the
  // lap's expected time, so the stint trend is spread over the corners.
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
  const deltasOf = (k: number) => withCorners.map(l => delta.get(l.id)![k]);
  const center = range(nc).map(k => median(deltasOf(k)) ?? 0);
  for (const d of delta.values()) {
    for (let k = 0; k < nc; k++) d[k] -= center[k];
  }
  const sigma = range(nc).map(k =>
    Math.max(0.02, robustSigma(deltasOf(k)) ?? 0),
  );

  const results: LapResult[] = laps.map(l => {
    const r = residual(l);
    const d = delta.get(l.id) ?? null;
    // With a handful of laps there is no pace to be off.
    const offPace =
      laps.length >= MIN_SPREAD_LAPS &&
      r >= Math.max(t.offPaceZ * lapSigma, t.offPaceMinSec);
    const losses: CornerLoss[] = [];
    if (d) {
      const lost = sum(d.map(v => Math.max(0, v)));
      const candidates = range(nc)
        .filter(k => d[k] > 0 && d[k] / sigma[k] >= t.lossZ)
        .sort((a, b) => d[b] - d[a]);
      let covered = 0;
      for (const k of candidates) {
        const z = d[k] / sigma[k];
        const mistake = z >= t.mistakeZ && d[k] >= t.mistakeSec;
        // Off-pace laps list corners until most of the loss is explained.
        // Other laps only list outright mistakes.
        if (!mistake && (!offPace || covered >= t.lossCover * lost)) continue;
        const c = l.corners![k];
        const tags: LossTag[] = [];
        if ((c.offTrackSec ?? 0) > 0) tags.push('off-track');
        if (c.localYellowSec >= t.yellowSec) tags.push('local-yellow');
        losses.push({
          corner: k + 1,
          seconds: round(d[k], 3)!,
          z: round(z, 1)!,
          mistake,
          tags,
        });
        covered += d[k];
      }
    }
    return {
      id: l.id,
      lapNumber: l.lapNumber,
      stint: l.stint,
      expected: round(expected.get(l.id)!, 3)!,
      residual: round(r, 3)!,
      offPace,
      losses,
      cornerDelta: d ? d.map(v => round(v, 3)!) : null,
    };
  });

  const corners: CornerResult[] = range(nc).map(k => {
    const values = deltasOf(k);
    const p25 = quantile(values, 0.25) ?? 0;
    const clean = withCorners.filter(
      l => (l.corners![k].offTrackSec ?? 0) < t.cleanOffSec,
    );
    const best = clean.reduce<LapFacts | null>(
      (a, l) => (!a || l.corners![k].segTime < a.corners![k].segTime ? l : a),
      null,
    );
    const named = results.filter(r => r.losses.some(x => x.corner === k + 1));
    return {
      n: k + 1,
      medianSec:
        round(median(withCorners.map(l => l.corners![k].segTime)), 3) ?? 0,
      spreadSec: round(sigma[k], 3)!,
      lostSec: round(sum(values.map(v => Math.max(0, v - p25))), 2)!,
      named: named.length,
      mistakes: results.filter(r =>
        r.losses.some(x => x.corner === k + 1 && x.mistake),
      ).length,
      onTheTable: round((median(values) ?? 0) - p25, 3)!,
      bestSec: best ? round(best.corners![k].segTime, 3) : null,
      bestLap: best?.lapNumber ?? null,
      split: cornerSplit(withCorners, k, delta),
    };
  });

  const ordinary = results.filter(r => !r.offPace);
  const offPace = results.filter(r => r.offPace);
  const mistakes = results.flatMap(r => r.losses.filter(x => x.mistake));
  const lapTimes = laps.map(l => l.lapTime);
  const pace = median(lapTimes);
  const summary: Summary = {
    laps: laps.length,
    rawSpread: round(stdev(lapTimes), 3),
    scatter: round(stdev(ordinary.map(r => r.residual)), 3),
    withinHalfSecond:
      pace == null ? 0 : lapTimes.filter(v => Math.abs(v - pace) <= 0.5).length,
    offPaceLaps: offPace.length,
    offPaceSec: round(sum(offPace.map(r => r.residual)), 2)!,
    mistakes: mistakes.length,
    mistakeSec: round(sum(mistakes.map(x => x.seconds)), 2)!,
    onTheTable: round(sum(corners.map(c => c.onTheTable)), 2)!,
    bestLap: lapTimes.length ? round(Math.min(...lapTimes), 3) : null,
    optimalLap:
      corners.length && corners.every(c => c.bestSec != null)
        ? round(sum(corners.map(c => c.bestSec!)), 3)
        : null,
  };
  return {
    laps: results,
    corners,
    stints,
    summary,
    overview: overview(summary, stints, corners, results, laps),
    thresholds: t,
  };
}

// Where a corner's fast passes and slow passes part ways. Thirds by time,
// medians compared, so one odd pass does not decide it.
function cornerSplit(
  laps: LapFacts[],
  k: number,
  delta: Map<string, number[]>,
): CornerSplit | null {
  if (laps.length < 6) return null;
  const sorted = [...laps].sort(
    (a, b) => delta.get(a.id)![k] - delta.get(b.id)![k],
  );
  const third = Math.floor(sorted.length / 3);
  const fast = sorted.slice(0, third);
  const slow = sorted.slice(sorted.length - third);
  const diff = (pick: (c: CornerFacts) => number | null | undefined) => {
    const f = median(values(fast.map(l => pick(l.corners![k]))));
    const s = median(values(slow.map(l => pick(l.corners![k]))));
    return f == null || s == null ? null : s - f;
  };
  return {
    seconds:
      round(
        diff(c => c.segTime),
        3,
      ) ?? 0,
    brakeAtM: round(
      diff(c => c.brakeAtM),
      0,
    ),
    minSpeedKmh: round(
      diff(c => c.minSpeedKmh),
      1,
    ),
    fullThrottleAtM: round(
      diff(c => c.fullThrottleAtM),
      0,
    ),
  };
}

// Below this many laps a spread is not worth quoting.
const MIN_SPREAD_LAPS = 5;
// Per off-pace lap, name at most this many corners in the text.
const TEXT_CORNERS = 3;

function overview(
  s: Summary,
  stints: StintResult[],
  corners: CornerResult[],
  results: LapResult[],
  laps: LapFacts[],
): string {
  const parts = [`${s.laps} ${s.laps === 1 ? 'lap' : 'laps'}.`];
  if (s.laps >= MIN_SPREAD_LAPS && s.scatter != null) {
    parts.push(
      `Scatter ${s.scatter.toFixed(
        2,
      )} s around the pace trend (raw spread ${s.rawSpread?.toFixed(2)} s).`,
    );
  }
  if (s.bestLap != null && s.optimalLap != null) {
    parts.push(
      `Best lap ${s.bestLap.toFixed(
        3,
      )}; best sections add up to ${s.optimalLap.toFixed(3)}.`,
    );
  }
  const trend = stints.filter(st => Math.abs(st.trendPerLap) >= 0.01);
  if (trend.length) {
    parts.push(
      `Pace trend ${trend
        .map(st => `${signed(st.trendPerLap, 3)} s/lap in stint ${st.n}`)
        .join(', ')}.`,
    );
  }
  const off = results.filter(r => r.offPace);
  if (off.length) {
    const worst = [...off].sort((a, b) => b.residual - a.residual).slice(0, 3);
    const facts = new Map(laps.map(l => [l.id, l]));
    parts.push(
      `${off.length} ${
        off.length === 1 ? 'lap' : 'laps'
      } off pace, ${s.offPaceSec.toFixed(1)} s in all. ` +
        worst
          .map(r => {
            const where = r.losses
              .slice(0, TEXT_CORNERS)
              .map(
                x =>
                  `section ${x.corner} ${signed(x.seconds, 2)} s${
                    x.tags.includes('off-track') ? ' off track' : ''
                  }`,
              )
              .join(', ');
            const lap = facts.get(r.id);
            const tag = !where && lap?.offtrack ? ', off track' : '';
            return `Lap ${r.lapNumber} ${signed(r.residual, 1)} s${
              where ? ` (${where})` : tag
            }`;
          })
          .join('. ') +
        '.',
    );
  } else if (s.laps >= MIN_SPREAD_LAPS) {
    parts.push('No lap off pace.');
  }
  const lost = [...corners]
    .filter(c => c.lostSec >= 0.1)
    .sort((a, b) => b.lostSec - a.lostSec)
    .slice(0, 2);
  if (lost.length && s.laps >= MIN_SPREAD_LAPS) {
    parts.push(
      `Most time lost against repeatable pace: ${lost
        .map(c => `section ${c.n} (${c.lostSec.toFixed(1)} s)`)
        .join(', ')}.`,
    );
  }
  return parts.join(' ');
}

function signed(v: number, digits: number): string {
  return (v > 0 ? '+' : '') + v.toFixed(digits);
}

function values(list: (number | null | undefined)[]): number[] {
  return list.filter((v): v is number => v != null && Number.isFinite(v));
}

function mostCommon(list: string[]): string {
  const counts = new Map<string, number>();
  for (const v of list) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

function mode(list: number[]): number {
  const counts = new Map<number, number>();
  for (const v of list) counts.set(v, (counts.get(v) ?? 0) + 1);
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

function robustSigma(list: number[]): number | null {
  const m = median(list);
  if (m == null) return null;
  return 1.4826 * (median(list.map(v => Math.abs(v - m))) ?? 0);
}

function median(list: number[]): number | null {
  return quantile(list, 0.5);
}

function quantile(list: number[], q: number): number | null {
  const sorted = list.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function stdev(list: number[]): number | null {
  const v = list.filter(Number.isFinite);
  if (v.length < 2) return null;
  const mean = sum(v) / v.length;
  return Math.sqrt(sum(v.map(x => (x - mean) ** 2)) / (v.length - 1));
}

function sum(list: number[]): number {
  return list.reduce((a, b) => a + b, 0);
}

function unique(list: number[]): number[] {
  return [...new Set(list)].sort((a, b) => a - b);
}

function range(n: number): number[] {
  return Array.from({length: n}, (_, i) => i);
}

function round(value: number | null, digits: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}
