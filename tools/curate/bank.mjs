// Road bank (cross-slope) along a lap, in the corner map's distance frame (pit wall thread 94 #6337, #6338).
// The player's capture carries the car's full orientation (mOri) at 100 Hz. On asphalt at speed the car sits on the
// road, so its roll is the road's cross-slope; the body's own roll in a corner is negligible (about 0.01 deg per
// m/s2 of lateral acceleration). Pitch is the road's grade, which the curated height profile already gives (its
// grade over 10 to 30 m matches the car's pitch at corr 0.998, median 0.45 deg on Road Atlanta), so only the roll is
// stored: one source for the road's slope along and across. Each lap is placed on the map by fraction of its own path,
// as elevation.mjs does (the capture's xz path and the game's lap distance are different rulers). Measured against
// the game's replay file (all 54 cars of a Road Atlanta race, 102,540 car-frames) the profile is within 0.25 deg
// median / 2.4 deg p99 of each car's roll, where a level road is 0.69 / 4.2 deg off; the step (2, 5 or 10 m) does not
// change that.
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {columns, sqlPath} from '../sessions/duck.mjs';

export const BANK_STEP_M = 5;
/** Below this the car is not settled on the road (pit lane, spins, slow corners with a wheel on the kerb). */
export const MIN_SPEED_KPH = 60;
const PATH_SPREAD = 0.01;
const MIN_LAPS = 3;
/** Fewest laps that must have a value at a step for it to be measured, not filled from its neighbours. */
const MIN_LAPS_PER_STEP = 5;
/** ... and at least this share of the kept laps (a 30-lap capture needs 15 clean laps at a step, a 12-lap one 6). */
const MIN_LAP_SHARE = 0.5;
/** A step whose clean laps disagree by more than this (p10 to p90, degrees) is a coin flip, not a road feature: it is filled from its neighbours. */
const MAX_STEP_SPREAD_DEG = 1.5;
const MIN_SAMPLES_PER_STEP = 5;
const MAX_FILLED_SHARE = 0.1;
/** The longest stretch filled from its neighbours (a slow hairpin, a kerb-hopping chicane), metres. */
const MAX_GAP_M = 100;
/** Lap-to-lap p10 to p90 of the per-lap medians, degrees: a capture noisier than this is not a clean set of laps. */
const MAX_SPREAD_P90_DEG = 3;

const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const percentile = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
const round2 = x => Math.round(x * 100) / 100;

function pathOf(lap) {
  const n = lap.x.length;
  const dist = new Float64Array(n);
  let s = 0;
  for (let i = 1; i < n; i++) {
    s += Math.hypot(lap.x[i] - lap.x[i - 1], lap.z[i] - lap.z[i - 1]);
    dist[i] = s;
  }
  return {dist, len: s, roll: lap.rollDeg, ok: lap.ok};
}

/** The median of the valid samples within `halfM` of path distance `m`; NaN with too few. */
function windowMedian(path, m, halfM, from) {
  const {dist, roll, ok} = path;
  const vals = [];
  let i = from.i;
  while (i > 0 && dist[i - 1] >= m - halfM) i--;
  while (i < dist.length && dist[i] < m - halfM) i++;
  from.i = i;
  for (let j = i; j < dist.length && dist[j] <= m + halfM; j++) if (ok[j]) vals.push(roll[j]);
  return vals.length >= MIN_SAMPLES_PER_STEP ? median(vals) : NaN;
}

/** Linear fill of the NaN steps from the finite ones either side, round the lap. */
function fillRound(v) {
  const n = v.length;
  const known = [];
  for (let i = 0; i < n; i++) if (Number.isFinite(v[i])) known.push(i);
  if (!known.length) return v;
  return v.map((x, i) => {
    if (Number.isFinite(x)) return x;
    const prev = known.findLast(k => k < i);
    const next = known.find(k => k > i);
    const prevI = prev === undefined ? known[known.length - 1] - n : prev;
    const nextI = next === undefined ? known[0] + n : next;
    const a = v[((prevI % n) + n) % n];
    const b = v[((nextI % n) + n) % n];
    return a + ((b - a) * (i - prevI)) / (nextI - prevI);
  });
}

/**
 * @param {{x: Float64Array, z: Float64Array, rollDeg: Float64Array, ok: Uint8Array}[]} laps
 *   `ok` marks the samples to use: at speed, on asphalt. Roll is + with the right side up.
 * @param {number} lengthM the curated map's lap length
 * @returns {{bank: {stepM: number, rollDeg: number[], source: string}|null, refusals: string[], stats: object}}
 */
export function bankFromLaps(laps, lengthM) {
  const refusals = [];
  if (!(lengthM > 0)) refusals.push('the map has no lap length');
  const paths = (laps ?? []).map(pathOf).filter(p => p.len > 0 && p.dist.length > 1);
  if (!paths.length) refusals.push('the capture has no laps with a path');
  if (refusals.length) return {bank: null, refusals, stats: {}};

  const mid = median(paths.map(p => p.len));
  const kept = paths.filter(p => Math.abs(p.len - mid) / mid <= PATH_SPREAD);
  if (kept.length < MIN_LAPS)
    refusals.push(
      `only ${kept.length} laps are within 1% of the median path length (${round2(mid)} m), ${MIN_LAPS} are needed`,
    );
  if (refusals.length) return {bank: null, refusals, stats: {laps: kept.length, dropped: paths.length - kept.length}};

  const steps = Math.floor(lengthM / BANK_STEP_M);
  const roll = new Array(steps + 1).fill(NaN);
  const spreads = [];
  const need = Math.max(MIN_LAPS_PER_STEP, Math.ceil(kept.length * MIN_LAP_SHARE));
  const lapsAt = new Array(steps + 1).fill(0);
  const spreadAt = new Array(steps + 1).fill(NaN);
  let tooFew = 0;
  let tooNoisy = 0;
  const cursors = kept.map(() => ({i: 0}));
  let filled = 0;
  let run = 0;
  let longest = 0;
  for (let s = 0; s <= steps; s++) {
    const frac = (s * BANK_STEP_M) / lengthM;
    const rolls = [];
    kept.forEach((p, k) => {
      const r = windowMedian(p, frac * p.len, (BANK_STEP_M / 2) * (p.len / lengthM), cursors[k]);
      if (Number.isFinite(r)) rolls.push(r);
    });
    const sorted = [...rolls].sort((a, b) => a - b);
    const spread = percentile(sorted, 0.9) - percentile(sorted, 0.1);
    lapsAt[s] = rolls.length;
    if (rolls.length >= need && spread <= MAX_STEP_SPREAD_DEG) {
      roll[s] = median(rolls);
      spreadAt[s] = spread;
      spreads.push(spread);
      run = 0;
    } else {
      if (rolls.length < need) tooFew++;
      else tooNoisy++;
      filled++;
      run++;
      longest = Math.max(longest, run);
    }
  }
  const filledShare = filled / (steps + 1);
  if (filledShare > MAX_FILLED_SHARE)
    refusals.push(
      `${(filledShare * 100).toFixed(1)}% of the lap has fewer than ${need} clean laps or laps that disagree by over ${MAX_STEP_SPREAD_DEG} deg, more than ${MAX_FILLED_SHARE * 100}%`,
    );
  if (longest * BANK_STEP_M > MAX_GAP_M)
    refusals.push(
      `a stretch of ${longest * BANK_STEP_M} m has fewer than ${need} clean laps or laps that disagree by over ${MAX_STEP_SPREAD_DEG} deg, more than ${MAX_GAP_M} m`,
    );
  spreads.sort((a, b) => a - b);
  const spreadP90 = percentile(spreads, 0.9);
  if (spreadP90 > MAX_SPREAD_P90_DEG)
    refusals.push(`lap-to-lap roll spread p90 is ${round2(spreadP90)} deg, more than ${MAX_SPREAD_P90_DEG} deg`);

  const rollFilled = fillRound(roll);
  const finite = rollFilled.filter(Number.isFinite);
  // the extremes among the steps that were measured (not filled), with how many laps and how much they scatter there
  let lo = -1;
  let hi = -1;
  for (let i = 0; i < roll.length; i++) {
    if (!Number.isFinite(roll[i])) continue;
    if (lo < 0 || roll[i] < roll[lo]) lo = i;
    if (hi < 0 || roll[i] > roll[hi]) hi = i;
  }
  const at = i => (i < 0 ? null : {m: i * BANK_STEP_M, rollDeg: round2(roll[i]), laps: lapsAt[i], spreadDeg: round2(spreadAt[i])});
  return {
    bank: refusals.length
      ? null
      : {
          stepM: BANK_STEP_M,
          rollDeg: rollFilled.map(round2),
          source: 'capture mOri roll, laps at speed on asphalt, median per step, lap-fraction aligned',
        },
    refusals,
    stats: {
      laps: kept.length,
      dropped: paths.length - kept.length,
      pathM: round2(mid),
      filledShare: round2(filledShare),
      longestGapM: longest * BANK_STEP_M,
      spreadP90: round2(spreadP90),
      rollMin: finite.length ? round2(Math.min(...finite)) : null,
      rollMax: finite.length ? round2(Math.max(...finite)) : null,
      lowest: at(lo),
      highest: at(hi),
      stepsNeed: need,
      stepsTooFew: tooFew,
      stepsTooNoisy: tooNoisy,
    },
  };
}

/**
 * Player rows of one capture split by lap, with the roll from the orientation matrix. mOri is the world-from-car
 * rotation (world = mOri x local; checked: the world velocity it gives matches the finite difference of mPos at
 * corr 1.0 on all three axes), so the car's right axis is its first column and right.y = mOri_1_x is sin(roll).
 */
export function readCaptureAttitude(captureDir) {
  const files = readdirSync(captureDir)
    .filter(f => /^player-\d+\.parquet$/.test(f))
    .sort();
  if (!files.length) throw new Error(`${captureDir} has no player parquet`);
  const src = `read_parquet([${files.map(f => sqlPath(join(captureDir, f))).join(', ')}])`;
  const data = columns(
    ':memory:',
    `SELECT mLapNumber AS lap, mElapsedTime AS t, mPos_x AS x, mPos_z AS z,
       degrees(asin(least(1.0, greatest(-1.0, mOri_1_x)))) AS roll,
       CAST(sqrt(mLocalVel_x * mLocalVel_x + mLocalVel_z * mLocalVel_z) * 3.6 > ${MIN_SPEED_KPH}
         AND fl_mSurfaceType = 0 AND fr_mSurfaceType = 0 AND rl_mSurfaceType = 0 AND rr_mSurfaceType = 0 AS INTEGER) AS ok
     FROM ${src} ORDER BY mElapsedTime`,
  );
  const laps = [];
  let current = null;
  let number = null;
  for (let i = 0; i < data.lap.length; i++) {
    if (data.lap[i] !== number) {
      current = {lapNumber: data.lap[i], t0: data.t[i], t1: data.t[i], x: [], z: [], roll: [], ok: []};
      laps.push(current);
      number = data.lap[i];
    }
    current.t1 = data.t[i];
    current.x.push(data.x[i]);
    current.z.push(data.z[i]);
    current.roll.push(data.roll[i]);
    current.ok.push(data.ok[i]);
  }
  return laps.map(lap => ({
    lapNumber: lap.lapNumber,
    duration: lap.t1 - lap.t0,
    x: Float64Array.from(lap.x),
    z: Float64Array.from(lap.z),
    rollDeg: Float64Array.from(lap.roll),
    ok: Uint8Array.from(lap.ok),
  }));
}
