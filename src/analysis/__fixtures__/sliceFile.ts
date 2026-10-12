import {sliceSamples} from '../nativeSamples';
import {SLICE_CHANNELS} from '../cornerSlices';
import {type GridTrace, type RawTrace, resampleTrace} from '../resample';

// A corner slice file built the way tools/sessions/cornerSlices.mjs builds it,
// for tests: integer deltas, the file's own `digits`. The uploader's real
// output is checked against the app's path in
// tools/sessions/cornerSlices.test.mjs.

export const LENGTH_M = 2000;
export const STEP_M = 5;
const DIGITS: Record<string, number> = {
  d: 3,
  timeS: 4,
  lat: 6,
  lon: 6,
  speedKph: 3,
  throttlePct: 2,
  brakePct: 2,
  steeringPct: 2,
  pathLateralM: 2,
  trackEdgeM: 2,
  gear: 0,
};

/** A 2 km lap at 100 Hz: brake and throttle at 50 Hz, lateral at 10 Hz. */
export function syntheticRaw(shift = 0): RawTrace {
  const n = 2001;
  const each = (f: (i: number) => number) =>
    Array.from({length: n}, (_, i) => f(i));
  return {
    lapDistPct: each(i => i / (n - 1)),
    speedKph: each(i => 180 + 60 * Math.sin(i / 120 + shift)),
    throttlePct: each(i =>
      i % 2 === 0 ? 50 + 50 * Math.cos(i / 90 + shift) : NaN,
    ),
    brakePct: each(i =>
      i % 2 === 0 ? 50 + 50 * Math.sin(i / 90 + shift) : NaN,
    ),
    steeringPct: each(i => 20 * Math.sin(i / 150 + shift)),
    gear: each(() => 3),
    lat: each(i => (i % 10 === 0 ? 60 + i * 1e-5 : NaN)),
    lon: each(i => (i % 10 === 0 ? i * 1e-5 : NaN)),
    pathLateralM: each(i => (i % 10 === 0 ? 2 * Math.sin(i / 300) : NaN)),
    trackEdgeM: each(i => (i % 10 === 0 ? 6 + Math.cos(i / 300) : NaN)),
  };
}

const deltas = (ints: number[]) =>
  ints.map((v, i) => (i === 0 ? v : v - ints[i - 1]));
const q = (values: number[], digits: number) =>
  deltas(values.map(v => Math.round(v * 10 ** digits)));

export function gridOf(raw: RawTrace): GridTrace {
  return resampleTrace(raw, LENGTH_M, STEP_M);
}

/** One lap's entry in a slice file, cut from its own grid. */
export function sliceLapJson(
  id: string,
  grid: GridTrace,
  windowM: [number, number],
) {
  const samples: Record<string, {d: number[]; v: number[]}> = {};
  for (const ch of SLICE_CHANNELS) {
    const w = sliceSamples(grid.samples[ch], windowM[0], windowM[1]);
    samples[ch] = {d: q(w.distanceM, DIGITS.d), v: q(w.values, DIGITS[ch])};
  }
  const i0 = Math.ceil(windowM[0] / STEP_M);
  const i1 = Math.floor(windowM[1] / STEP_M);
  return {
    id,
    gridFromM: i0 * STEP_M,
    timeS: q(grid.timeS.slice(i0, i1 + 1), DIGITS.timeS),
    lat: q(grid.lat.slice(i0, i1 + 1), DIGITS.lat),
    lon: q(grid.lon.slice(i0, i1 + 1), DIGITS.lon),
    samples,
  };
}

export function sliceFileJson(
  laps: ReturnType<typeof sliceLapJson>[],
  apexM: number,
  windowM: [number, number],
) {
  return {
    v: 2,
    corner: 4,
    apexM,
    lengthM: LENGTH_M,
    stepM: STEP_M,
    digits: DIGITS,
    windowM,
    laps,
  };
}
