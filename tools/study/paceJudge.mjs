// Study only (pit-wall thread 1 #4886, #4889): which laps are the driver's
// repeatable pace and which are events. Five candidate judges as pure
// functions over one input shape, so the simulation (gasket) and the real
// sessions (tyre) run identical code. Not used by the app.
//
// Input: a session's candidate laps (timed, whole, no pit lane), grouped by
// stint, in driving order:
//   {stints: [{laps: [{
//     id, lapTime,                 // s
//     sections: number[] | null,   // s per section, the start straight first; same count every lap
//     evidence: {offTrackSec, impact, yellowSec, trafficS, blueS} | null,
//   }]}]}
// Output: Map(lapId -> {out, p, why}) for every candidate lap. `p` is the
// judge's probability that the lap is an event where it has one, else 0 or 1.

export const MIN_LAPS = 12; // a session under this drops nothing (as #577)
export const GUARD_S = 0.3; // #577's degenerate-sigma guard

// ---- robust helpers -------------------------------------------------------

export function median(xs) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function weightedMedian(xs, ws) {
  const v = xs
    .map((x, i) => [x, ws[i]])
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

/** 1.4826 × MAD: the normal sigma a median absolute deviation stands for. */
export function robustSigma(xs) {
  const m = median(xs);
  return 1.4826 * median(xs.map(x => Math.abs(x - m)));
}

/** Theil–Sen line through (i, y): [intercept, slope]. */
function theilSen(ys) {
  const slopes = [];
  for (let i = 0; i < ys.length; i++)
    for (let j = i + 1; j < ys.length; j++) slopes.push((ys[j] - ys[i]) / (j - i));
  const slope = slopes.length ? median(slopes) : 0;
  const intercept = median(ys.map((y, i) => y - slope * i));
  return [intercept, slope];
}

/** Indexes of laps inside a run of `min`+ consecutive flagged laps. */
function inRuns(flags, min = 3) {
  const keep = new Set();
  for (let i = 0; i < flags.length; ) {
    if (!flags[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < flags.length && flags[j]) j++;
    if (j - i >= min) for (let k = i; k < j; k++) keep.add(k);
    i = j;
  }
  return keep;
}

function allLaps(session) {
  return session.stints.flatMap(s => s.laps);
}

function tooShort(session) {
  const laps = allLaps(session);
  if (laps.length >= MIN_LAPS) return null;
  return new Map(laps.map(l => [l.id, {out: false, p: 0, why: 'under min laps'}]));
}

function hasSections(session) {
  const laps = allLaps(session);
  const n = laps[0]?.sections?.length ?? 0;
  return n >= 2 && laps.every(l => l.sections?.length === n);
}

// ---- (a) lap residual, 3 sigma, as #577 ------------------------------------

/** Per stint a Theil–Sen line through the lap times; the residuals. */
function lapResiduals(session) {
  const out = [];
  for (const stint of session.stints) {
    const [a, b] = theilSen(stint.laps.map(l => l.lapTime));
    stint.laps.forEach((l, i) => out.push({lap: l, stint, i, r: l.lapTime - (a + b * i)}));
  }
  return out;
}

export function judgeA(session, {k = 3, runRule = true} = {}) {
  const short = tooShort(session);
  if (short) return short;
  const res = lapResiduals(session);
  const sigma = robustSigma(res.map(x => x.r));
  const limit = Math.max(k * sigma, GUARD_S);
  const flags = res.map(x => x.r > limit);
  const result = new Map();
  for (const stint of session.stints) {
    const idx = res.map((x, n) => [x, n]).filter(([x]) => x.stint === stint);
    const kept = runRule ? inRuns(idx.map(([, n]) => flags[n])) : new Set();
    idx.forEach(([x, n], i) => {
      const out = flags[n] && !kept.has(i);
      result.set(x.lap.id, {
        out,
        p: out ? 1 : 0,
        why: out ? `lap +${x.r.toFixed(2)} s > ${limit.toFixed(2)}` : kept.has(i) ? 'run of 3+' : '',
      });
    });
  }
  return result;
}

// ---- (b) per-section robust z on a straight trend ---------------------------

export function judgeB(session, {k = 5, floorS = 0.2} = {}) {
  const short = tooShort(session);
  if (short) return short;
  if (!hasSections(session)) return judgeA(session);
  const n = allLaps(session)[0].sections.length;
  const resid = []; // [lapIndexInSession][section]
  const laps = [];
  for (const stint of session.stints) {
    const lines = Array.from({length: n}, (_, s) => theilSen(stint.laps.map(l => l.sections[s])));
    stint.laps.forEach((l, i) => {
      laps.push(l);
      resid.push(l.sections.map((t, s) => t - (lines[s][0] + lines[s][1] * i)));
    });
  }
  return sectionSpikes(laps, resid, n, k, floorS);
}

function sectionSpikes(laps, resid, n, k, floorS) {
  const sig = Array.from({length: n}, (_, s) => robustSigma(resid.map(r => r[s])));
  const result = new Map();
  laps.forEach((l, i) => {
    let worst = -1;
    let zMax = -Infinity;
    for (let s = 0; s < n; s++) {
      const z = resid[i][s] / Math.max(sig[s], 1e-3);
      if (resid[i][s] > floorS && z > zMax) {
        zMax = z;
        worst = s;
      }
    }
    const out = worst >= 0 && zMax > k;
    result.set(l.id, {
      out,
      p: worst >= 0 ? spikePosterior(zMax, n) : 0,
      why: out ? `S${worst} +${resid[i][worst].toFixed(2)} s, z ${zMax.toFixed(1)}` : '',
      section: out ? worst : null,
    });
  });
  return result;
}

/**
 * P(event | the lap's largest section z): a contaminated normal. Clean, the
 * largest of n standard normals; an event, a z spread wide (half-normal,
 * scale 10). Prior 5 %. Indicative only: the judges decide on thresholds.
 */
function spikePosterior(z, n, prior = 0.05, scale = 10) {
  const phi = x => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
  const Phi = x => 0.5 * (1 + erf(x / Math.SQRT2));
  const clean = n * phi(z) * Phi(z) ** (n - 1);
  const event = z > 0 ? (2 / scale) * phi(z / scale) : 0;
  const num = prior * event;
  return num / (num + (1 - prior) * clean || 1);
}

function erf(x) {
  // Abramowitz–Stegun 7.1.26, |error| < 1.5e-7.
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

// ---- (c) two-component mixture on the lap residuals --------------------------

/**
 * Clean laps: N(0, σ) around the trend; events: σ-shifted exponential (only
 * slower). π and the exponential's mean by EM; σ held at the robust sigma (12
 * laps cannot fit a free mixture). A lap is out when p > 0.5.
 */
export function judgeC(session, {iterations = 50} = {}) {
  const short = tooShort(session);
  if (short) return short;
  const res = lapResiduals(session);
  const r = res.map(x => x.r);
  const sigma = Math.max(robustSigma(r), GUARD_S / 3);
  let pi = 0.05;
  let mean = Math.max(1, 3 * sigma);
  const nd = x => Math.exp(-((x / sigma) ** 2) / 2) / (sigma * Math.sqrt(2 * Math.PI));
  const ed = x => (x > 0 ? Math.exp(-x / mean) / mean : 0);
  let p = r.map(() => 0);
  for (let it = 0; it < iterations; it++) {
    p = r.map(x => {
      const a = pi * ed(x);
      const b = (1 - pi) * nd(x);
      return a + b > 0 ? a / (a + b) : x > 0 ? 1 : 0;
    });
    const w = p.reduce((t, v) => t + v, 0);
    pi = Math.min(0.5, Math.max(1e-3, w / r.length));
    if (w > 1e-6) mean = Math.max(sigma, r.reduce((t, x, i) => t + p[i] * Math.max(x, 0), 0) / w);
  }
  const result = new Map();
  res.forEach((x, i) =>
    result.set(x.lap.id, {
      out: p[i] > 0.5,
      p: p[i],
      why: p[i] > 0.5 ? `lap +${x.r.toFixed(2)} s, p ${p[i].toFixed(2)}` : '',
    }),
  );
  return result;
}

// ---- (d) evidence first ------------------------------------------------------

export const EVIDENCE = {offTrackSec: 0, yellowSec: 0, trafficS: 3, blueS: 3};

function evidenceOf(l) {
  const e = l.evidence;
  if (!e) return [];
  const why = [];
  if (e.offTrackSec > EVIDENCE.offTrackSec) why.push(`off ${e.offTrackSec.toFixed(1)} s`);
  if (e.impact) why.push('impact');
  if (e.yellowSec > EVIDENCE.yellowSec) why.push(`yellow ${e.yellowSec.toFixed(1)} s`);
  if (e.trafficS >= EVIDENCE.trafficS) why.push(`traffic ${e.trafficS.toFixed(1)} s`);
  if (e.blueS >= EVIDENCE.blueS) why.push(`blue ${e.blueS.toFixed(1)} s`);
  return why;
}

export function judgeD(session, options = {}) {
  const short = tooShort(session);
  if (short) return short;
  const base = judgeB(session, options);
  const result = new Map();
  for (const l of allLaps(session)) {
    const ev = evidenceOf(l);
    const b = base.get(l.id);
    result.set(
      l.id,
      ev.length ? {out: true, p: 1, why: ev.join(', ')} : b,
    );
  }
  return result;
}

// ---- (e) section-shared pace -------------------------------------------------

/**
 * The stint's pace curve: a running median of `w` laps (Tukey), with his
 * end-point rule at both ends (the end value, the next smoothed one, and the
 * straight-line extrapolation of the two after it). A median follows a linear
 * fade exactly and keeps a run of more than w/2 laps as part of the curve; a
 * fitted line over it would smooth the run away (it did in the first draft).
 */
export function smoothPace(f, {w = 5} = {}) {
  const n = f.length;
  if (n < w) return f.map(() => median(f));
  const h = w >> 1;
  const rm = f.map((_, i) =>
    i < h || i >= n - h ? NaN : median(f.slice(i - h, i + h + 1)),
  );
  // Ends: grow the window one lap at a time toward the edge (median of 3 at
  // distance 1), then Tukey's rule at the very end.
  for (let d = h - 1; d >= 1; d--) {
    rm[d] = median(f.slice(0, 2 * d + 1));
    rm[n - 1 - d] = median(f.slice(n - 1 - 2 * d));
  }
  rm[0] = median([f[0], rm[1], 3 * rm[1] - 2 * rm[2]]);
  rm[n - 1] = median([f[n - 1], rm[n - 2], 3 * rm[n - 2] - 2 * rm[n - 3]]);
  return rm;
}

export function judgeE(session, {k = 5, floorS = 0.2, kLap = 3} = {}) {
  const short = tooShort(session);
  if (short) return short;
  if (!hasSections(session)) return judgeA(session);
  const laps = allLaps(session);
  const n = laps[0].sections.length;
  // Section bases over the whole session; the lap's pace factor is the median
  // (weighted by section length) of its sections against them, so a mistake
  // in one or two sections does not move it.
  const base = Array.from({length: n}, (_, s) => median(laps.map(l => l.sections[s])));
  const total = base.reduce((t, b) => t + b, 0);
  const f = new Map(laps.map(l => [l, weightedMedian(l.sections.map((t, s) => t / base[s]), base)]));
  // Whole-lap departure: the pace factor against its smoothed stint curve, in
  // seconds over the whole lap. A run of 3+ moves the running median, so it
  // is the curve, not a departure.
  const dep = new Map();
  for (const stint of session.stints) {
    const fs = stint.laps.map(l => f.get(l));
    const fh = smoothPace(fs);
    stint.laps.forEach((l, i) => dep.set(l, (fs[i] - fh[i]) * total));
  }
  const sigLap = Math.max(robustSigma([...dep.values()]), GUARD_S / 3);
  // Section spikes against the lap's own pace.
  const resid = laps.map(l => l.sections.map((t, s) => t - base[s] * f.get(l)));
  const spikes = sectionSpikes(laps, resid, n, k, floorS);
  const result = new Map();
  for (const l of laps) {
    const sp = spikes.get(l.id);
    const d = dep.get(l);
    const lapOut = d > Math.max(kLap * sigLap, GUARD_S);
    const ev = evidenceOf(l);
    const why = [
      sp.out && sp.why,
      lapOut && `whole lap +${d.toFixed(2)} s > ${Math.max(kLap * sigLap, GUARD_S).toFixed(2)}`,
      (sp.out || lapOut) && ev.length && `(${ev.join(', ')})`,
    ]
      .filter(Boolean)
      .join(' ');
    result.set(l.id, {
      out: sp.out || lapOut,
      p: lapOut ? Math.max(sp.p, 0.99) : sp.p,
      why,
      kind: sp.out ? 'section' : lapOut ? 'whole lap' : '',
    });
  }
  return result;
}

// ---- (f) lap residual against the section-shared pace curve ----------------

/**
 * (e)'s stint curve (the median of the lap's sections against their bases,
 * smoothed by a running median, so a mistake in one or two sections cannot
 * bend it and a run of 3+ laps is part of it), but the decision is on the
 * whole lap time against that curve: 3 sigma of the session's residuals, the
 * 0.3 s guard. Sections name where the time went; they do not decide.
 * (e)'s per-section spike test dropped 9-27 % of clean laps in the
 * simulation: a corner's loss is skewed, so one section's tail is no event.
 */
export function judgeF(session, {k = 3, spikeK = null, floorS = 0.2} = {}) {
  const short = tooShort(session);
  if (short) return short;
  if (!hasSections(session)) return judgeA(session);
  const laps = allLaps(session);
  const n = laps[0].sections.length;
  const base = Array.from({length: n}, (_, s) => median(laps.map(l => l.sections[s])));
  const total = base.reduce((t, b) => t + b, 0);
  const f = new Map(laps.map(l => [l, weightedMedian(l.sections.map((t, s) => t / base[s]), base)]));
  const res = new Map();
  for (const stint of session.stints) {
    const fh = smoothPace(stint.laps.map(l => f.get(l)));
    stint.laps.forEach((l, i) => res.set(l, l.lapTime - total * fh[i]));
  }
  const sigma = robustSigma([...res.values()]);
  const limit = Math.max(k * sigma, GUARD_S);
  const resid = laps.map(l => l.sections.map((t, s) => t - base[s] * f.get(l)));
  const spikes = spikeK == null ? null : sectionSpikes(laps, resid, n, spikeK, floorS);
  const result = new Map();
  laps.forEach((l, i) => {
    const r = res.get(l);
    const lapOut = r > limit;
    const sp = spikes?.get(l.id);
    const out = lapOut || !!sp?.out;
    // Where the time went: the two sections with the most loss against the lap's own pace.
    const where = resid[i]
      .map((e, s) => [e, s])
      .sort((a, b) => b[0] - a[0])
      .slice(0, 2)
      .filter(([e]) => e > 0.05)
      .map(([e, s]) => `S${s} +${e.toFixed(2)}`)
      .join(', ');
    const ev = evidenceOf(l);
    result.set(l.id, {
      out,
      p: out ? 1 : 0,
      why: out
        ? [`lap +${r.toFixed(2)} s (limit ${limit.toFixed(2)})`, where, ev.length && `(${ev.join(', ')})`].filter(Boolean).join(' ')
        : '',
    });
  });
  return result;
}

export const JUDGES = {a: judgeA, b: judgeB, c: judgeC, d: judgeD, e: judgeE, f: judgeF};
