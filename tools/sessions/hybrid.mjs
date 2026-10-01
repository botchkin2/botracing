// Hybrid energy of a Hypercar lap (pit-wall thread 44 #1743, tach's audit
// pit-wall/ideas/2026-09-30-hypercar-hybrid-audit.md): the battery's state of
// charge at the lap's ends, the energy the motor deployed and the brakes
// regenerated, where on the lap that happened, and the lift-and-coast before
// each braking zone. Numbers off the recording's own channels, never advice.
//
// Channels (archive names, tools/sessions/lmu.mjs slug):
//   so_c         state of charge, % (20 Hz, held between samples)
//   regen_rate   power in WATTS although the file labels it kW: positive =
//                regenerating into the battery, negative = the motor
//                deploying. Integrated as watts over time against the change
//                in SoC it gives one constant, about 0.013 kWh per 1 % SoC,
//                i.e. a battery of about 1.3 kWh; as kW it would be 1000 times
//                too big.
// An LMP2 or a GT3 logs both flat at 0 (neverLeavesZero): no hybrid.
import {neverLeavesZero} from './fuelFacts.mjs';
import {BRAKE_ON_PCT, BRAKE_RELEASED_PCT, sampleTicks} from './pedalPoints.mjs';

/**
 * Bump when the rules below change: it goes into analyze.mjs's blockVersions,
 * which the sync's session fingerprint hashes, and onto each lap's
 * `hybrid.v`.
 * 1: SoC at the lap's ends; kWh deployed and regenerated; peak kW; per
 * section energy and SoC where windows are given; lift-and-coast before each
 * brake application.
 */
export const HYBRID_VERSION = 1;

const W_PER_KW = 1000;
const WS_PER_KWH = 3.6e6;

/** Throttle below this (the driver's pedal) is lifted. */
export const LIFT_THROTTLE_PCT = 5;
/** A coast shorter than this is a pedal change, not a lift. */
export const MIN_COAST_S = 0.2;
/** Below this speed the car is crawling (a pit lane, a spin), not coasting into a corner. */
export const MIN_COAST_KMH = 80;

const round = (v, digits) => {
  if (v == null || !Number.isFinite(v)) return null;
  const p = 10 ** digits;
  return Math.round(v * p) / p;
};

/**
 * Whether the recording has a hybrid to read: both channels exist and at
 * least one leaves 0. Called once per recording.
 */
export function hasHybrid(s) {
  return Boolean(
    s.so_c &&
      s.regen_rate &&
      !(neverLeavesZero(s.so_c) && neverLeavesZero(s.regen_rate)),
  );
}

/**
 * Deployed and regenerated energy over ticks [a, b], kWh, as the integral of
 * the power over each sample's time to the next one (the channel is 100 Hz,
 * so a rectangle is exact enough). Samples with no reading add nothing.
 */
export function energyKwh(s, a, b) {
  let deployWs = 0;
  let regenWs = 0;
  let peakDeployW = 0;
  let peakRegenW = 0;
  for (let i = a; i < b; i++) {
    const p = s.regen_rate[i];
    const dt = s.t[i + 1] - s.t[i];
    if (!Number.isFinite(p) || !(dt > 0)) continue;
    if (p > 0) {
      regenWs += p * dt;
      if (p > peakRegenW) peakRegenW = p;
    } else if (p < 0) {
      deployWs += -p * dt;
      if (-p > peakDeployW) peakDeployW = -p;
    }
  }
  return {
    deployKwh: deployWs / WS_PER_KWH,
    regenKwh: regenWs / WS_PER_KWH,
    peakDeployKw: peakDeployW / W_PER_KW,
    peakRegenKw: peakRegenW / W_PER_KW,
  };
}

/**
 * Where on the lap the battery goes: the energy and the SoC change in each
 * window. `windows` are `{key, fromM, toM}` in the map's frame (the lap's
 * fraction times the track map's length, as every corner window is) and
 * `mapM(i)` the map-frame distance of tick i. A window with no tick in it
 * is left out.
 */
function sectionEnergy(s, i0, i1, windows, mapM) {
  const out = [];
  for (const w of windows) {
    let a = -1;
    let b = -1;
    for (let i = i0; i <= i1; i++) {
      const m = mapM(i);
      if (m >= w.fromM && m < w.toM) {
        if (a < 0) a = i;
        b = i;
      }
    }
    if (a < 0 || b <= a) continue;
    const e = energyKwh(s, a, b);
    out.push({
      key: w.key,
      deployKwh: round(e.deployKwh, 4),
      regenKwh: round(e.regenKwh, 4),
      socStartPct: round(s.so_c[a], 1),
      socEndPct: round(s.so_c[b], 1),
    });
  }
  return out;
}

/**
 * The lifts before braking in ticks [i0, i1]: for each brake application (the
 * pedal reaching BRAKE_ON_PCT after being released below BRAKE_RELEASED_PCT),
 * the stretch just before it with the throttle lifted and no brake, if it is
 * at least MIN_COAST_S long and the car was above MIN_COAST_KMH. Pedals are
 * read on their own sample ticks (50 Hz in a 100 Hz file). `dist(i)` is the
 * lap's raw distance at tick i. Returns the events and their totals.
 */
export function liftAndCoast(
  s,
  hz,
  baseHz,
  i0,
  i1,
  dist,
  minCoastS = MIN_COAST_S,
) {
  const throttle = s.throttle_pos_unfiltered || s.throttle_pct;
  const brake = s.brake_pct;
  if (!throttle || !brake) return null;
  const samples = sampleTicks(hz, baseHz, i0, i1).ticks;
  const events = [];
  let released = true;
  let coastFrom = -1;
  for (let k = 0; k < samples.length; k++) {
    const i = samples[k];
    const thr = throttle[i];
    const brk = brake[i];
    if (brk < BRAKE_RELEASED_PCT) released = true;
    const coasting = thr < LIFT_THROTTLE_PCT && brk < BRAKE_ON_PCT;
    if (!coasting) {
      if (brk >= BRAKE_ON_PCT && released && coastFrom >= 0) {
        // The application starts here: the coast ran from `coastFrom` to it.
        const coastS = s.t[i] - s.t[coastFrom];
        if (coastS >= minCoastS && s.speed_kmh[coastFrom] >= MIN_COAST_KMH) {
          events.push({
            atM: round(dist(coastFrom), 1),
            brakeAtM: round(dist(i), 1),
            fromKmh: round(s.speed_kmh[coastFrom], 0),
            toKmh: round(s.speed_kmh[i], 0),
            coastS: round(coastS, 2),
            coastM: round(dist(i) - dist(coastFrom), 1),
          });
        }
      }
      if (brk >= BRAKE_ON_PCT) released = false;
      coastFrom = -1;
    } else if (coastFrom < 0) {
      coastFrom = i;
    }
  }
  return {
    events,
    count: events.length,
    seconds: round(
      events.reduce((a, e) => a + e.coastS, 0),
      2,
    ),
    metres: round(
      events.reduce((a, e) => a + e.coastM, 0),
      1,
    ),
  };
}

/**
 * The hybrid facts of one lap. `win` is the lap's whole time window as ticks
 * `{a, b}`: SoC and energy are read over it, not over the lap's distance
 * ticks (which stop where the lap distance resets, often at the pit entry),
 * so consecutive laps tile, as the fuel does. `i0`..`i1` are the distance
 * ticks (lift-and-coast and the sections read those), `hzOf` each channel's
 * logged rate (the recording's `hz`), `dist(i)` the lap's raw distance at a
 * tick, and the optional `sections` ({windows, mapM}) the energy by window.
 * Null for a recording with no hybrid. The pit lane is included, so a lap
 * that overlaps one is marked by the lap's own `pitlane`.
 */
export function lapHybrid(s, hzOf, baseHz, i0, i1, dist, win, sections = null) {
  if (!hasHybrid(s) || !(i1 > i0) || !(win.b > win.a)) return null;
  const e = energyKwh(s, win.a, win.b);
  return {
    v: HYBRID_VERSION,
    socStartPct: round(s.so_c[win.a], 1),
    socEndPct: round(s.so_c[win.b], 1),
    deployKwh: round(e.deployKwh, 3),
    regenKwh: round(e.regenKwh, 3),
    // From the rounded parts, so the three numbers on the doc agree.
    netKwh: round(round(e.regenKwh, 3) - round(e.deployKwh, 3), 3),
    peakDeployKw: round(e.peakDeployKw, 1),
    peakRegenKw: round(e.peakRegenKw, 1),
    sections: sections
      ? sectionEnergy(s, i0, i1, sections.windows, sections.mapM)
      : null,
    liftCoast: liftAndCoast(
      s,
      (s.throttle_pos_unfiltered
        ? hzOf.throttle_pos_unfiltered
        : hzOf.throttle_pct) ?? baseHz,
      baseHz,
      i0,
      i1,
      dist,
    ),
  };
}

/**
 * The SoC across a stint: where it was at the first and last lap with a
 * reading, and the least-squares slope in % per lap over the green laps'
 * end-of-lap readings (the lap counted from the stint's first). A stint with
 * under MIN_TREND_LAPS readings has no slope: a trend of two points is not
 * one. Null when no lap of the stint carries hybrid facts.
 */
export const MIN_TREND_LAPS = 3;
export function stintHybrid(stintLaps, isGreen) {
  const laps = stintLaps.filter(l => l.hybrid);
  if (laps.length === 0) return null;
  const first = laps[0].hybrid;
  const last = laps[laps.length - 1].hybrid;
  const pts = laps
    .map((l, k) => ({k, y: l.hybrid.socEndPct, green: isGreen(l)}))
    .filter(p => p.green && Number.isFinite(p.y));
  let slope = null;
  if (pts.length >= MIN_TREND_LAPS) {
    const n = pts.length;
    const mx = pts.reduce((a, p) => a + p.k, 0) / n;
    const my = pts.reduce((a, p) => a + p.y, 0) / n;
    const sxx = pts.reduce((a, p) => a + (p.k - mx) ** 2, 0);
    const sxy = pts.reduce((a, p) => a + (p.k - mx) * (p.y - my), 0);
    slope = sxx > 0 ? sxy / sxx : null;
  }
  return {
    socStartPct: first.socStartPct,
    socEndPct: last.socEndPct,
    laps: laps.length,
    greenLaps: pts.length,
    socPerLapPct: round(slope, 2),
    deployKwh: round(
      laps.reduce((a, l) => a + l.hybrid.deployKwh, 0),
      3,
    ),
    regenKwh: round(
      laps.reduce((a, l) => a + l.hybrid.regenKwh, 0),
      3,
    ),
  };
}
