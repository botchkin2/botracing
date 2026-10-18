// Height along a lap, in the corner map's distance frame (pit wall thread 86).
// The capture's xz path and the game's lap distance are different rulers. Each
// lap is sampled by fraction of its own path, then placed at that fraction of
// the map length.
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {columns, sqlPath} from '../sessions/duck.mjs';

export const ELEVATION_STEP_M = 10;
const PATH_SPREAD = 0.01;
const HEIGHT_P95_M = 1;
const MIN_LAPS = 3;

const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

const round2 = x => Math.round(x * 100) / 100;

function pathOf(lap) {
  const n = lap.x.length;
  const dist = new Float64Array(n);
  let s = 0;
  for (let i = 1; i < n; i++) {
    s += Math.hypot(lap.x[i] - lap.x[i - 1], lap.z[i] - lap.z[i - 1]);
    dist[i] = s;
  }
  return {dist, y: lap.y, len: s};
}

function at(path, metres) {
  const {dist, y} = path;
  if (metres <= 0) return y[0];
  const last = dist.length - 1;
  if (metres >= dist[last]) return y[last];
  let lo = 0;
  let hi = last;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (dist[mid] < metres) lo = mid;
    else hi = mid;
  }
  const span = dist[hi] - dist[lo];
  const t = span === 0 ? 0 : (metres - dist[lo]) / span;
  return y[lo] + t * (y[hi] - y[lo]);
}

/**
 * @param {{x: Float64Array, y: Float64Array, z: Float64Array}[]} laps
 * @param {number} lengthM the curated map's lap length
 * @returns {{elevation: {stepM: number, heightM: number[], source: string}|null, refusals: string[], stats: object}}
 */
export function elevationFromLaps(laps, lengthM) {
  const refusals = [];
  if (!(lengthM > 0)) refusals.push('the map has no lap length');
  const paths = (laps ?? [])
    .map(pathOf)
    .filter(p => p.len > 0 && p.y.length > 1);
  if (!paths.length) refusals.push('the capture has no laps with a path');
  if (refusals.length) return {elevation: null, refusals, stats: {}};

  const mid = median(paths.map(p => p.len));
  const kept = paths.filter(p => Math.abs(p.len - mid) / mid <= PATH_SPREAD);
  if (kept.length < MIN_LAPS)
    refusals.push(
      `only ${
        kept.length
      } laps are within 1% of the median path length (${round2(
        mid,
      )} m), ${MIN_LAPS} are needed`,
    );
  const lens = kept.map(p => p.len);
  const spread = lens.length
    ? (Math.max(...lens) - Math.min(...lens)) / mid
    : 0;
  if (kept.length >= MIN_LAPS && spread > PATH_SPREAD)
    refusals.push(
      `the capture laps' path lengths differ by ${(spread * 100).toFixed(
        2,
      )}%, more than 1%`,
    );

  const steps = Math.floor(lengthM / ELEVATION_STEP_M);
  const spreads = [];
  for (let i = 0; i <= steps; i++) {
    const frac = (i * ELEVATION_STEP_M) / lengthM;
    const ys = kept.map(p => at(p, frac * p.len)).sort((a, b) => a - b);
    if (ys.length) spreads.push(ys[ys.length - 1] - ys[0]);
  }
  spreads.sort((a, b) => a - b);
  const p95 = spreads.length ? spreads[Math.floor(spreads.length * 0.95)] : 0;
  if (kept.length >= MIN_LAPS && p95 > HEIGHT_P95_M)
    refusals.push(
      `lap-to-lap height p95 is ${round2(p95)} m, more than ${HEIGHT_P95_M} m`,
    );

  let min = Infinity;
  let max = -Infinity;
  const heightM = [];
  if (!refusals.length) {
    for (let i = 0; i <= steps; i++) {
      const frac = (i * ELEVATION_STEP_M) / lengthM;
      const h = median(kept.map(p => at(p, frac * p.len)));
      heightM.push(round2(h));
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  return {
    elevation: refusals.length
      ? null
      : {
          stepM: ELEVATION_STEP_M,
          heightM,
          source: 'capture mPos_y, lap-fraction aligned',
        },
    refusals,
    stats: {
      laps: kept.length,
      dropped: paths.length - kept.length,
      pathM: round2(mid),
      spread,
      p95: round2(p95),
      min: refusals.length ? null : round2(min),
      max: refusals.length ? null : round2(max),
    },
  };
}

/** Player rows of one capture, split each time mLapNumber changes. */
export function readCaptureLaps(captureDir) {
  const files = readdirSync(captureDir)
    .filter(f => /^player-\d+\.parquet$/.test(f))
    .sort();
  if (!files.length) throw new Error(`${captureDir} has no player parquet`);
  const src = `read_parquet([${files
    .map(f => sqlPath(join(captureDir, f)))
    .join(', ')}])`;
  const data = columns(
    ':memory:',
    `SELECT mLapNumber AS lap, mPos_x AS x, mPos_y AS y, mPos_z AS z
     FROM ${src} ORDER BY mElapsedTime`,
  );
  const laps = [];
  let current = null;
  let number = null;
  for (let i = 0; i < data.lap.length; i++) {
    if (data.lap[i] !== number) {
      current = {lapNumber: data.lap[i], x: [], y: [], z: []};
      laps.push(current);
      number = data.lap[i];
    }
    current.x.push(data.x[i]);
    current.y.push(data.y[i]);
    current.z.push(data.z[i]);
  }
  return laps.map(lap => ({
    lapNumber: lap.lapNumber,
    x: Float64Array.from(lap.x),
    y: Float64Array.from(lap.y),
    z: Float64Array.from(lap.z),
  }));
}

/** The capture laps whose lap number is one the session's map kept. */
export function keepMeasuredLaps(laps, lapNumbers) {
  const want = new Set(lapNumbers);
  const kept = [];
  let dropped = 0;
  for (const lap of laps) {
    if (want.has(lap.lapNumber)) kept.push(lap);
    else dropped++;
  }
  return {laps: kept, dropped};
}
