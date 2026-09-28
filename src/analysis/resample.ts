// Lap traces on a common distance grid, and the time difference between laps.
//
// A 100 Hz trace samples time, not distance, so two laps never line up sample
// for sample. Resampling each onto the same grid (every stepM metres from the
// line) lets channels be compared point by point. Samples are evenly spaced
// in time (100 Hz), so elapsed time is the sample index over the rate; on the
// grid, the time difference to a reference is a plain subtraction. (Integrating
// ds / v instead drifts: 0.75 s over an 80 s lap at Road Atlanta.)
//
// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.

// A channel logged slower than the trace holds NaN on the rows where it
// recorded nothing; only its real samples are interpolated.
export interface RawTrace {
  // Fraction of the lap, 0..1, one per sample.
  lapDistPct: number[];
  speedKph: number[];
  throttlePct: number[];
  brakePct: number[];
  steeringPct: number[];
  gear: number[];
  lat: number[];
  lon: number[];
}

export interface GridTrace {
  stepM: number;
  distanceM: number[];
  speedKph: number[];
  throttlePct: number[];
  brakePct: number[];
  steeringPct: number[];
  gear: number[];
  lat: number[];
  lon: number[];
  // Seconds since the first sample.
  timeS: number[];
}

// Linear interpolation of ys at x over ascending xs. Holds the ends.
function interpolator(xs: number[], ys: number[]): (x: number) => number {
  let i = 0;
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    const last = xs.length - 1;
    if (x >= xs[last]) return ys[last];
    while (i < last - 1 && xs[i + 1] < x) i++;
    while (i > 0 && xs[i] > x) i--;
    const span = xs[i + 1] - xs[i];
    const t = span > 0 ? (x - xs[i]) / span : 0;
    return ys[i] + (ys[i + 1] - ys[i]) * t;
  };
}

// Step interpolation for discrete channels (gear).
function stepper(xs: number[], ys: number[]): (x: number) => number {
  let i = 0;
  return (x: number) => {
    while (i < xs.length - 1 && xs[i + 1] <= x) i++;
    return ys[i];
  };
}

// Distance of every sample. LMU logs lap distance at 10 Hz and holds it in
// between, so LapDistPct is stair-stepped at 100 Hz. Integrating speed gives a
// smooth distance per sample; scaling it to span the logged start and end
// removes the speed channel's small bias. Samples after the wrap at the line
// are dropped.
function sampleDistances(
  raw: RawTrace,
  lengthM: number,
  sampleHz: number,
): number[] {
  const pct = raw.lapDistPct;
  let end = pct.length - 1;
  for (let i = 1; i < pct.length; i++)
    if (pct[i] < pct[i - 1] - 0.5) {
      end = i - 1;
      break;
    }
  const cum: number[] = [0];
  for (let i = 1; i <= end; i++) {
    const v = (raw.speedKph[i] + raw.speedKph[i - 1]) / 2 / 3.6;
    cum.push(cum[i - 1] + v / sampleHz);
  }
  const span = (pct[end] - pct[0]) * lengthM;
  const scale = cum[end] > 0 && span > 0 ? span / cum[end] : 1;
  return cum.map(c => pct[0] * lengthM + c * scale);
}

// Indexes where distance increases (drops stationary pit samples), so the
// interpolation's xs are strictly ascending.
function ascending(d: number[]): number[] {
  const keep: number[] = [];
  let prev = -Infinity;
  for (let i = 0; i < d.length; i++)
    if (d[i] > prev) {
      keep.push(i);
      prev = d[i];
    }
  return keep;
}

export const TRACE_HZ = 100;

export function resampleTrace(
  raw: RawTrace,
  lengthM: number,
  stepM: number,
  sampleHz: number = TRACE_HZ,
): GridTrace {
  const d = sampleDistances(raw, lengthM, sampleHz);
  const keep = ascending(d);
  const pick = (a: number[]) => keep.map(i => a[i]);
  const xs = pick(d);
  const n = Math.floor(lengthM / stepM) + 1;
  const distanceM = Array.from({length: n}, (_, i) => i * stepM);
  const lin = (a: number[]) => {
    const real = keep.filter(i => Number.isFinite(a[i]));
    if (real.length === 0) return distanceM.map(() => NaN);
    return distanceM.map(
      interpolator(
        real.map(i => d[i]),
        real.map(i => a[i]),
      ),
    );
  };
  const speedKph = lin(raw.speedKph);
  const timeS = lin(raw.lapDistPct.map((_, i) => i / sampleHz));
  return {
    stepM,
    distanceM,
    speedKph,
    throttlePct: lin(raw.throttlePct),
    brakePct: lin(raw.brakePct),
    steeringPct: lin(raw.steeringPct),
    gear: distanceM.map(stepper(xs, pick(raw.gear))),
    lat: lin(raw.lat),
    lon: lin(raw.lon),
    timeS,
  };
}

// Seconds this lap is behind the reference at each grid point. Positive =
// slower. Both traces must share the grid.
// When both official lap times are given, the residual at the line (the trace
// starts and ends a few metres off it) is spread linearly over the lap, so the
// line ends exactly on the official gap.
export function timeDiffS(
  lap: GridTrace,
  ref: GridTrace,
  official?: {lapS: number; refS: number},
): number[] {
  const n = Math.min(lap.timeS.length, ref.timeS.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(lap.timeS[i] - ref.timeS[i]);
  if (official && n > 1) {
    const residual = official.lapS - official.refS - out[n - 1];
    for (let i = 0; i < n; i++) out[i] += (residual * i) / (n - 1);
  }
  return out;
}

// Index on the grid nearest to a distance.
export function gridIndex(trace: GridTrace, distanceM: number): number {
  const i = Math.round(distanceM / trace.stepM);
  return Math.max(0, Math.min(trace.distanceM.length - 1, i));
}
