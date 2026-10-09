// Per-corner slices of every lap's trace (pit-wall thread 27, #1021/#1129).
//
// The Corner screen draws a window of a few hundred metres around one apex.
// Fetching each lap's whole 100 Hz CSV (~0.55 MB gzipped) to draw it capped
// the screen at a dozen extra laps. Here the uploader cuts that window out of
// every lap once, so the app fetches one small file per corner and draws every
// lap.
//
// Parity by construction: a slice holds exactly what the app's own
// `resampleTrace(parseTraceCsv(csv))` produces for the lap (src/analysis/
// resample.ts, imported here as is), restricted to the window:
//   - every channel's recorded samples at their own rates and distances
//     (`samples`, the rows where the channel logged something: docs
//     CODE_STANDARDS section 6). Slower channels are not held or repeated.
//   - the time, latitude and longitude on the 5 m grid (`timeS`, `lat`,
//     `lon`): the delta from entry needs the time, which cannot be rebuilt
//     from samples, and the corner map draws the reference lap's position.
// The app rebuilds its grid channels from the samples with the same
// interpolation, so nothing is blended in the file.
//
// Distances are metres along the lap in the app's frame (lap fraction times
// the track map's length), not from the apex, so a slice reads like a
// GridTrace. A window that reaches the start/finish line is clipped at 0 or
// the lap's end, as the per-lap CSV path is today.
//
// Run: node --test tools/sessions/cornerSlices.test.mjs
import {createHash} from 'node:crypto';
import {
  MAP_AFTER_M,
  MAP_BEFORE_M,
  WINDOW_PAD_M,
  ZOOM_AFTER_M,
  ZOOM_BEFORE_M,
  zoomWindowFor,
} from '../../src/analysis/cornerWindows.ts';
import {resampleTrace} from '../../src/analysis/resample.ts';
import {parseTraceCsv} from '../../src/analysis/traceCsv.ts';

// The wider of the screen's windows, so the two cannot drift apart.
export const SLICE_BEFORE_M = Math.max(ZOOM_BEFORE_M, MAP_BEFORE_M);
export const SLICE_AFTER_M = Math.max(ZOOM_AFTER_M, MAP_AFTER_M);
export const GRID_STEP_M = 5;
// 2 adds gear (format 1 files have none, and the decoder reads them without it).
// The decoder reads a file's own `windowM`, so a wider window needs no new format
// (src/analysis/cornerSlices.ts).
export const SLICE_FORMAT = 2;
// A slice reaches this far past its corner window on each side, so the
// delta from the boundary and the lines run to the window's edges (the pad
// is shared with the screen: src/analysis/cornerWindows.ts).
export {WINDOW_PAD_M};
const DIST_DIGITS = 3;

// Channels a slice carries, and how many decimals each keeps: the same as the
// trace CSV they are cut from (Speed is m/s to 4 decimals, so km/h to 3; the
// pedals are 0..1 to 4 decimals, so % to 2), so a slice loses nothing the app
// draws today and a threshold such as brake >= 10 % cannot flip on rounding.
const CHANNELS = [
  ['speedKph', 3],
  ['throttlePct', 2],
  ['brakePct', 2],
  ['steeringPct', 2],
  ['pathLateralM', 2],
  ['trackEdgeM', 2],
  ['gear', 0],
];

/**
 * Corner number and apex for every corner of a track map, in map order. With
 * the layout's windows (`windowsOf`), each also carries its extent: from the
 * start of its section's window (where laps share speed, which the delta is
 * drawn from, so it is always inside the slice) to the end of its own window,
 * a part's for a compound section, else the section's.
 */
export function mapCorners(map, windows = null) {
  const out = [];
  const sectionWindows = (windows ?? []).filter(w => w.kind === 'section');
  (map.corners ?? []).forEach((section, k) => {
    const parts = section.parts?.length ? section.parts : [section];
    const w = sectionWindows[k] ?? null;
    parts.forEach((p, i) => {
      const own = w?.parts?.length ? w.parts[i] : w;
      out.push({
        n: p.n,
        apexM: p.apexM,
        ...(own && w ? {extent: {fromM: w.fromM, toM: own.toM}} : {}),
      });
    });
  });
  return out;
}

// The window a slice covers: the wider of the screen's two windows around the
// apex (zoom, braking map), and the zoom window as the screen widens it to the
// corner's own window (`zoomWindowFor`: the window plus a pad, at most
// WINDOW_EXTRA_M past the zoom window). One function for both, so the slice
// can never be narrower than what the screen asks for.
function sliceWindow(apexM, lengthM, extent) {
  const [from, to] = zoomWindowFor(apexM, extent ?? null);
  return [
    Math.max(0, Math.min(apexM - SLICE_BEFORE_M, from)),
    Math.min(lengthM, Math.max(apexM + SLICE_AFTER_M, to)),
  ];
}

/** First index with a[i] >= x. */
function lowerBound(a, x) {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Integers, then differences between neighbours: a smooth channel becomes runs
// of small numbers, which gzip shrinks far more than long decimals. Decoding
// is a running sum (src/data/traces/cornerSlices.ts) and gives back exactly
// the rounded values, no smoothing.
const deltas = ints => ints.map((v, i) => (i === 0 ? v : v - ints[i - 1]));

// The real samples inside [fromM, toM] plus one either side, so a line and
// the app's interpolation run to the window's edges (as sliceSamples does).
// d in millimetres (DIST_DIGITS), v in units of 10^-digits. A sample's
// distance is an estimate, but rounding it coarsely moves a steep pedal edge:
// at 0.1 m a throttle going 100 to 0 in 0.3 m read 7 % off at a grid point.
function windowSamples(s, fromM, toM, digits) {
  const a = Math.max(0, lowerBound(s.distanceM, fromM) - 1);
  const b = Math.min(s.distanceM.length, lowerBound(s.distanceM, toM) + 1);
  const scale = 10 ** digits;
  return {
    d: deltas(
      s.distanceM.slice(a, b).map(v => Math.round(v * 10 ** DIST_DIGITS)),
    ),
    v: deltas(s.values.slice(a, b).map(v => Math.round(v * scale))),
  };
}

/**
 * One lap's slice for one corner, or null when the lap has no sample in the
 * window. grid: the lap's resampleTrace result.
 */
export function lapSlice(id, grid, apexM, lengthM, extent = null) {
  const [fromM, toM] = sliceWindow(apexM, lengthM, extent);
  const samples = {};
  for (const [name, digits] of CHANNELS) {
    samples[name] = windowSamples(grid.samples[name], fromM, toM, digits);
  }
  if (samples.speedKph.d.length === 0) return null;
  // The time on the 5 m grid, from the first grid point at or after fromM.
  const i0 = Math.ceil(fromM / grid.stepM);
  const i1 = Math.min(grid.distanceM.length - 1, Math.floor(toM / grid.stepM));
  // A lap with no position (no Lat/Lon) has NaN there: leave the array empty
  // rather than write a null the decoder would have to guess about.
  const onGrid = (a, digits) => {
    const w = a.slice(i0, i1 + 1);
    return w.every(Number.isFinite)
      ? deltas(w.map(v => Math.round(v * 10 ** digits)))
      : [];
  };
  return {
    id,
    gridFromM: i0 * grid.stepM,
    timeS: onGrid(grid.timeS, 4),
    lat: onGrid(grid.lat, 6),
    lon: onGrid(grid.lon, 6),
    samples,
  };
}

/**
 * The corner files of one session. laps: [{id, csv}] (csv is a function so a
 * lap's text is dropped after use); map: {lengthM, corners}. Returns
 * {files: [{n, text}], corners, hash}, or null without a map.
 */
export function buildCornerSlices(laps, map, windows = null) {
  if (!map || !map.lengthM || !(map.corners ?? []).length) return null;
  const corners = mapCorners(map, windows);
  const perCorner = new Map(corners.map(c => [c.n, []]));
  for (const lap of laps) {
    const raw = parseTraceCsv(lap.csv());
    const grid = resampleTrace(raw, map.lengthM, GRID_STEP_M);
    for (const c of corners) {
      const slice = lapSlice(lap.id, grid, c.apexM, map.lengthM, c.extent);
      if (slice) perCorner.get(c.n).push(slice);
    }
  }
  const files = corners.map(c => ({
    n: c.n,
    text: JSON.stringify({
      v: SLICE_FORMAT,
      corner: c.n,
      apexM: c.apexM,
      lengthM: map.lengthM,
      stepM: GRID_STEP_M,
      // Decimals each array keeps: the decoder divides by 10^digits.
      digits: {
        d: DIST_DIGITS,
        timeS: 4,
        lat: 6,
        lon: 6,
        ...Object.fromEntries(CHANNELS),
      },
      windowM: sliceWindow(c.apexM, map.lengthM, c.extent),
      laps: perCorner.get(c.n),
    }),
  }));
  // Named by content, so the route can cache a file as immutable: a resync
  // that changes any lap writes a new set under a new hash (camber #1129).
  const h = createHash('sha1');
  for (const f of files) h.update(f.text);
  return {
    files,
    corners: corners.map(c => c.n),
    hash: h.digest('hex').slice(0, 12),
  };
}
