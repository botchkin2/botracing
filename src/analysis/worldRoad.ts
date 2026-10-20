// The 3D road, fitted in the frame the cars are in. Every car's world x/z minus its pathLateralM (along the right-hand
// normal of its own direction of travel) is a point on the game's centre line; all of them, every car and every lap,
// are fitted over lap distance by a Gaussian local-linear regression (no bins), then resampled to equal arc length.
// Cars and road share one frame by construction, so a car drawn at its own recorded position sits on the road it drove
// on (thread 94: the surface's road is built from GPS lat/lon in another frame, up to 7 m off at the T7 hairpin).
// Width: the surface's measured half-widths (frame-free). Height: the curated profile at the point's lap distance.
// Plain TypeScript with erasable syntax only: Node can run it.

import {DEFAULT_HALF_WIDTH_M, type ChaseElevation, type ChaseRoad} from './chaseRoad.ts';
import {bankOnLap, type Bank} from './bank.ts';
import {heightAt} from './elevation.ts';
import {roadUseSteps} from './roadUse.ts';
import type {Field} from './field.ts';
import {runSteps, type Steps} from './steps.ts';

/** The width of the fit's kernel, metres of lap distance. */
export const FIT_SIGMA_M = 5;
/** Metres between the points of the road. */
export const WORLD_ROAD_STEP_M = 1.5;
/** A car slower than this is not on its line (grid, spin, stopped). */
const MIN_SPEED_MS = 2;
/** A sample further than this from the first fit is an outlier (a spin, the pit exit, a mid-lap rejoin). */
const OUTLIER_M = 4;
/** |pathLateralM| beyond this is not a car on the track. */
const MAX_LATERAL_M = 30;
/** The fit is evaluated every GRID_M of lap distance (the road is resampled at WORLD_ROAD_STEP_M after). */
const GRID_M = 2;
/** Too few samples in a kernel window to trust a fit there. */
const MIN_WEIGHT = 1e-6;
/** The window of the median first pass, and the fewest samples it will take a median of. */
const MEDIAN_WINDOW_M = 6;
const MIN_WINDOW_SAMPLES = 5;
/** The median is taken every this many grid points: it only finds outliers (4 m away), a 10 m chord sags under 0.4 m at a 30 m radius. */
const MEDIAN_STRIDE = 5;
/** How much work one chunk does between yields (samples, grid points), so a chunk is a fraction of a millisecond. */
const SAMPLES_PER_CHUNK = 20000;
const GRID_POINTS_PER_CHUNK = 8;
const ROAD_POINTS_PER_CHUNK = 200;

export interface WorldRoadInput {
  field: Field;
  /** The lap as the game's lap distance measures it (the field's own). */
  lapM: number;
  /** The surface's measured half-widths per bin of lap distance (its own length), or null for the default width. */
  edges: {stepM: number; lengthM: number; leftM: number[]; rightM: number[]} | null;
  /** The track's curated height profile, and the lap length it is measured on; null for a flat road. */
  elevation: {stepM: number; heightM: number[]} | null;
  /** The map's lap length: the ruler of the height and bank profiles. */
  elevationLapM: number;
  /** The track's curated bank (the map's `bank`), read on the same lap as the height; null for a road level across. */
  bank: Bank | null;
}

interface Samples {
  ld: number[];
  x: number[];
  y: number[];
  /** The car's own offset from the centre line, right of travel positive. */
  lat: number[];
}

/** Every moving, out-of-the-pits car sample moved onto the game's centre line. */
function* centreSamples(field: Field, lapM: number): Steps<Samples> {
  const out: Samples = {ld: [], x: [], y: [], lat: []};
  const n = field.timeS.length;
  for (const car of field.cars) {
    for (let u = 1; u < n - 1; u++) {
      if (u % SAMPLES_PER_CHUNK === 0) yield;
      const d = car.lapDistM[u];
      const lat = car.pathLateralM[u];
      if (Number.isNaN(d) || !Number.isFinite(lat) || Math.abs(lat) > MAX_LATERAL_M) continue;
      if (car.inPits[u] !== 0) continue;
      const dx = car.xM[u + 1] - car.xM[u - 1];
      const dz = car.zM[u + 1] - car.zM[u - 1];
      const dt = field.timeS[u + 1] - field.timeS[u - 1];
      const run = Math.hypot(dx, dz);
      if (!(run > 0) || !(dt > 0) || run / dt < MIN_SPEED_MS) continue;
      // right of the direction of travel (x east, z north): (tz, -tx)
      const nx = dz / run;
      const nz = -dx / run;
      out.ld.push(((d % lapM) + lapM) % lapM);
      out.x.push(car.xM[u] - lat * nx);
      out.y.push(car.zM[u] - lat * nz);
      out.lat.push(lat);
    }
  }
  return out;
}

/** The samples in 1 m buckets of lap distance, so a kernel window reads only its own buckets. */
function* bucket(s: Samples, lapM: number, keep: (i: number) => boolean): Steps<{start: Int32Array; order: Int32Array; buckets: number}> {
  const buckets = Math.ceil(lapM / GRID_M);
  const start = new Int32Array(buckets + 1);
  const picked: number[] = [];
  for (let i = 0; i < s.ld.length; i++) {
    if (i % SAMPLES_PER_CHUNK === 0) yield;
    if (keep(i)) picked.push(i);
  }
  for (let k = 0; k < picked.length; k++) {
    if (k % SAMPLES_PER_CHUNK === 0) yield;
    start[Math.min(buckets - 1, Math.floor(s.ld[picked[k]] / GRID_M)) + 1]++;
  }
  for (let b = 0; b < buckets; b++) start[b + 1] += start[b];
  const fill = start.slice(0, buckets);
  const order = new Int32Array(picked.length);
  for (let k = 0; k < picked.length; k++) {
    if (k % SAMPLES_PER_CHUNK === 0) yield;
    const i = picked[k];
    order[fill[Math.min(buckets - 1, Math.floor(s.ld[i] / GRID_M))]++] = i;
  }
  return {start, order, buckets};
}

/**
 * Gaussian local-linear fit of (x, y) over lap distance on a 1 m grid. Local linear, not local mean: a bend's inside
 * does not pull the fit inward. Returns null where a window holds no samples.
 */
function* fitGrid(s: Samples, lapM: number, keep: (i: number) => boolean): Steps<{x: Float64Array; y: Float64Array; n: number} | null> {
  const {start, order, buckets} = yield* bucket(s, lapM, keep);
  const n = buckets;
  const gx = new Float64Array(n);
  const gy = new Float64Array(n);
  const reach = Math.ceil((3 * FIT_SIGMA_M) / GRID_M);
  const step = lapM / n;
  let empty = 0;
  for (let g = 0; g < n; g++) {
    if (g % GRID_POINTS_PER_CHUNK === 0) yield;
    const at = g * step;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let tx0 = 0;
    let tx1 = 0;
    let ty0 = 0;
    let ty1 = 0;
    for (let b = g - reach; b <= g + reach; b++) {
      const wrapped = ((b % n) + n) % n;
      const shift = b < 0 ? -lapM : b >= n ? lapM : 0;
      for (let k = start[wrapped]; k < start[wrapped + 1]; k++) {
        const i = order[k];
        const d = s.ld[i] + shift - at;
        const w = Math.exp(-0.5 * (d / FIT_SIGMA_M) ** 2);
        s0 += w;
        s1 += w * d;
        s2 += w * d * d;
        tx0 += w * s.x[i];
        tx1 += w * s.x[i] * d;
        ty0 += w * s.y[i];
        ty1 += w * s.y[i] * d;
      }
    }
    const den = s0 * s2 - s1 * s1;
    if (s0 < MIN_WEIGHT || !(Math.abs(den) > 1e-9)) {
      gx[g] = NaN;
      gy[g] = NaN;
      empty++;
      continue;
    }
    gx[g] = (tx0 * s2 - tx1 * s1) / den;
    gy[g] = (ty0 * s2 - ty1 * s1) / den;
  }
  return fillHoles(gx, gy, empty);
}

/** A grid with the stretches nobody drove (NaN) filled by the straight line across them; null when too much of the lap is empty. */
function fillHoles(gx: Float64Array, gy: Float64Array, empty: number): {x: Float64Array; y: Float64Array; n: number} | null {
  const n = gx.length;
  if (empty > n / 4) return null;
  // a hole (a stretch nobody drove): the straight line across it
  for (let g = 0; g < n; g++) {
    if (!Number.isNaN(gx[g])) continue;
    let a = g;
    while (Number.isNaN(gx[((a % n) + n) % n])) a--;
    let b = g;
    while (Number.isNaN(gx[b % n])) b++;
    const ia = ((a % n) + n) % n;
    const ib = b % n;
    const f = (g - a) / (b - a);
    gx[g] = gx[ia] + (gx[ib] - gx[ia]) * f;
    gy[g] = gy[ia] + (gy[ib] - gy[ia]) * f;
  }
  return {x: gx, y: gy, n};
}

/**
 * The line first, robustly: the median x and the median y of the samples within MEDIAN_WINDOW_M of each grid point. A
 * stray car (a spin, a rejoin) cannot pull a median the way it pulls a mean, so the outliers are found against this.
 */
function* medianGrid(s: Samples, lapM: number): Steps<{x: Float64Array; y: Float64Array; n: number} | null> {
  const {start, order, buckets} = yield* bucket(s, lapM, () => true);
  const n = buckets;
  const gx = new Float64Array(n);
  const gy = new Float64Array(n);
  const reach = Math.ceil(MEDIAN_WINDOW_M / 2 / GRID_M);
  let empty = 0;
  for (let g = 0; g < n; g++) {
    if (g % GRID_POINTS_PER_CHUNK === 0) yield;
    // only every MEDIAN_STRIDE-th point is taken; the points between are filled on the straight line between them
    if (g % MEDIAN_STRIDE !== 0) {
      gx[g] = NaN;
      gy[g] = NaN;
      continue;
    }
    const xs: number[] = [];
    const ys: number[] = [];
    for (let b = g - reach; b <= g + reach; b++) {
      const wrapped = ((b % n) + n) % n;
      for (let k = start[wrapped]; k < start[wrapped + 1]; k++) {
        xs.push(s.x[order[k]]);
        ys.push(s.y[order[k]]);
      }
    }
    if (xs.length < MIN_WINDOW_SAMPLES) {
      gx[g] = NaN;
      gy[g] = NaN;
      empty++;
      continue;
    }
    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    gx[g] = xs[xs.length >> 1];
    gy[g] = ys[ys.length >> 1];
  }
  return fillHoles(gx, gy, empty);
}

/**
 * The curated height at lap distance `ld`, closed on itself: the profile's last point is not its first (a GPS height
 * drifts a few decimetres over a lap), and the step at the line shows as a ramp in the road. The difference between the
 * two ends is taken out evenly over the whole lap, so the height at the end of the lap is the height at its start.
 */
export function closedHeight(elev: ChaseElevation, ld: number, lapM: number): number {
  const m = (((ld % lapM) + lapM) % lapM) * (elev.lengthM / lapM);
  const last = elev.heightM.length - 1;
  const seam = elev.heightM[last] - elev.heightM[0];
  return heightAt(elev, Math.min(m, last * elev.stepM)) - seam * (m / elev.lengthM);
}

/** The centre line fitted from the field, or null when the field has no usable positions. */
export function worldRoad(input: WorldRoadInput): ChaseRoad | null {
  return runSteps(worldRoadSteps(input));
}

/** The same fit as `worldRoad`, as steps: a page drives them in time slices (`analysis/steps` `runSliced`) so it never freezes. */
export function* worldRoadSteps(input: WorldRoadInput): Steps<ChaseRoad | null> {
  const {field, lapM, edges, elevation, elevationLapM, bank} = input;
  if (!field.hasPositions || !(lapM > 100)) return null;
  const s = yield* centreSamples(field, lapM);
  if (s.ld.length < 1000) return null;
  const first = yield* medianGrid(s, lapM);
  if (!first) return null;
  // then the fit, without the samples that were not on the line
  const near = (i: number) => {
    const g = Math.min(first.n - 1, Math.round((s.ld[i] / lapM) * first.n) % first.n);
    return Math.hypot(s.x[i] - first.x[g], s.y[i] - first.y[g]) < OUTLIER_M;
  };
  const fit = yield* fitGrid(s, lapM, near);
  if (!fit) return null;
  const n = fit.n;
  // equal arc length: the fit is on equal lap distance, which is not equal distance along the line
  const arc = new Float64Array(n + 1);
  for (let g = 0; g < n; g++) arc[g + 1] = arc[g] + Math.hypot(fit.x[(g + 1) % n] - fit.x[g], fit.y[(g + 1) % n] - fit.y[g]);
  const pathM = arc[n];
  const count = Math.max(8, Math.round(pathM / WORLD_ROAD_STEP_M));
  const step = pathM / count;
  const lapStep = lapM / n;
  const cx: number[] = [];
  const cy: number[] = [];
  const hl: number[] = [];
  const hr: number[] = [];
  const heightM: number[] = [];
  const bankDeg: number[] = [];
  const ldOfPoint: number[] = [];
  const bankOk = bank !== null && bank.rollDeg.length > 3 && bank.stepM > 0 && elevationLapM > 0;
  const elev =
    elevation && elevation.heightM.length > 3 && elevation.stepM > 0 && elevationLapM > 0
      ? {stepM: elevation.stepM, heightM: elevation.heightM, lengthM: elevationLapM}
      : null;
  const width = (arr: number[] | undefined, ld: number) => {
    if (!edges || !arr || arr.length === 0) return DEFAULT_HALF_WIDTH_M;
    const f = (((ld * edges.lengthM) / lapM / edges.stepM) % arr.length + arr.length) % arr.length;
    const i = Math.floor(f);
    const a = arr[i];
    const b = arr[(i + 1) % arr.length];
    const ok = (v: number) => Number.isFinite(v) && v > 1;
    if (!ok(a) || !ok(b)) return ok(a) ? a : ok(b) ? b : DEFAULT_HALF_WIDTH_M;
    return a + (b - a) * (f - i);
  };
  let g = 0;
  for (let k = 0; k < count; k++) {
    if (k % ROAD_POINTS_PER_CHUNK === 0) yield;
    const target = k * step;
    while (g < n - 1 && arc[g + 1] <= target) g++;
    const span = arc[g + 1] - arc[g];
    const t = span > 0 ? (target - arc[g]) / span : 0;
    const g2 = (g + 1) % n;
    cx.push(fit.x[g] + (fit.x[g2] - fit.x[g]) * t);
    cy.push(fit.y[g] + (fit.y[g2] - fit.y[g]) * t);
    const ld = (g + t) * lapStep;
    ldOfPoint.push(ld);
    hl.push(width(edges?.leftM, ld));
    hr.push(width(edges?.rightM, ld));
    if (elev) heightM.push(closedHeight(elev, ld, lapM));
    if (bankOk) bankDeg.push(bankOnLap(bank, ld * (elevationLapM / lapM), elevationLapM));
  }
  let elevMin = 0;
  if (elev) {
    elevMin = Infinity;
    for (const h of elev.heightM) elevMin = Math.min(elevMin, h);
  }
  return {
    stepM: step,
    lengthM: pathM,
    lapM,
    cx,
    cy,
    hl,
    hr,
    elev,
    heightM: elev ? heightM : null,
    elevMin,
    bankDeg: bankOk ? bankDeg : null,
    use: yield* roadUseSteps(s, lapM, ldOfPoint, hl, hr),
  };
}
