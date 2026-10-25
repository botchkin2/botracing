// A race's lap 0 is not a lap. The recording starts with the car parked on the
// grid: LapDistPct reads 0 and the position does not move for a minute or
// more, then the game starts the lap counter where the grid sits, so the
// distance jumps up to the grid slot's place on the lap (Sebring: 0 to 4,800 m
// in ten ticks) and the stretch to the start line follows. The game still gives
// it a lap time, so it came out timed and comparable, and its 5 m grid is the
// parked car stretched across most of the lap (pit-wall thread 44, #1462: with
// two comparable laps the speed band's median fell to 35 km/h mid-lap).
//
// That first lap's segment runs from the grid to the end of the first racing
// lap, so it holds two line crossings: the formation lap's and the racing lap's.
// racingSpan picks the racing lap's ticks, so its trace, distance and pedals are
// the racing lap's and not the formation lap's (pit-wall thread 100, ticket #49).
//
// Plain JavaScript, no imports: analyze.mjs and its test both call it.

/**
 * The version of this rule, hashed into the sync fingerprint through
 * analyze.mjs blockVersions. 1: a lap whose distance trace opens more than 100 m
 * along the lap, or jumps more than 100 m in a tick, is partial (grid starts of
 * a race's lap 0, file-boundary slivers). 2: a grid start's ticks are its racing
 * lap's (racingSpan), not the stretch up to the formation line.
 */
export const GRID_LAP_VERSION = 2;

/**
 * Biggest believable rise of the lap distance between two ticks, in metres.
 * A car at 100 m/s covers 1 m in a 100 Hz tick and 10 m in a 10 Hz one.
 */
export const MAX_TICK_RISE_M = 100;

/**
 * Whether the lap's distance trace starts away from the line or jumps, as a
 * grid start does. Daytona's grid is at 67 % of the lap: the trace opens there
 * with no jump to see, so the first tick counts too.
 */
export function jumpsOffTheGrid(dist) {
  if (dist.length > 0 && dist[0] > MAX_TICK_RISE_M) return true;
  for (let i = 1; i < dist.length; i++) {
    if (dist[i] - dist[i - 1] > MAX_TICK_RISE_M) return true;
  }
  return false;
}

/** A grid start sits still this long before the lap counter starts. */
export const GRID_PARKED_SEC = 10;

/** Ticks at the start of the trace where the distance has not moved by 1 m. */
function parkedTicks(dist) {
  let n = 0;
  while (n < dist.length && dist[n] - dist[0] < 1) n++;
  return n;
}

/**
 * Why a lap is partial, or null when it is not. 'grid': the car sat parked for
 * `GRID_PARKED_SEC` or more at the start and then the distance jumped (the parked car and
 * the roll to the line). 'file': any other stretch cut by a recording boundary
 * or a reset, including the sliver the game still gives a whole lap time
 * (Imola practice d184d6e1: 1.4 s long, 134.7 s on the clock).
 */
export function partialWhy(segPartial, dist, durationSec) {
  if (jumpsOffTheGrid(dist)) {
    const parkedSec = (parkedTicks(dist) / dist.length) * durationSec;
    return parkedSec >= GRID_PARKED_SEC ? 'grid' : 'file';
  }
  return segPartial ? 'file' : null;
}

/** A drop of the lap distance this big is the line: the distance starts again from 0. */
export const LINE_DROP_M = 150;

/** The racing lap is a span that covers at least this share of the lap's longest distance. */
export const RACING_SPAN_SHARE = 0.9;

/**
 * The ticks of a grid start's racing lap, as [first, last], or null when the lap
 * is not one: `dist` is the segment's raw lap distance, `from` and `to` its
 * first and last tick, `resets` the ticks where the distance dropped at the line.
 * The segment is cut into the spans between the line crossings. The first span
 * is the grid and the roll to the formation line (jumpsOffTheGrid); the racing
 * lap is the last span that covers 90 % of the longest distance seen. A segment
 * whose later spans fall short (the recording ends in the first racing lap, or
 * its end beacon came after the line) returns null, and the caller keeps the
 * first span as before.
 */
export function racingSpan(dist, from, to, resets) {
  if (resets.length === 0) return null;
  const spans = [];
  let first = from;
  for (const reset of resets) {
    spans.push([first, reset - 1]);
    first = reset;
  }
  spans.push([first, to]);
  const grid = spans[0];
  if (!jumpsOffTheGrid(dist.slice(grid[0], grid[1] + 1))) return null;
  let longest = 0;
  for (let i = from; i <= to; i++) if (dist[i] > longest) longest = dist[i];
  for (let k = spans.length - 1; k >= 1; k--) {
    const [a, b] = spans[k];
    if (dist[b] - dist[a] >= RACING_SPAN_SHARE * longest) return [a, b];
  }
  return null;
}
