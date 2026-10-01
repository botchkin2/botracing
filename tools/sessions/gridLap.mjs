// A race's lap 0 is not a lap. The recording starts with the car parked on the
// grid: LapDistPct reads 0 and the position does not move for a minute or
// more, then the game starts the lap counter where the grid sits, so the
// distance jumps up to the grid slot's place on the lap (Sebring: 0 to 4,800 m
// in ten ticks) and the stretch to the start line follows. The game still gives
// it a lap time, so it came out timed and comparable, and its 5 m grid is the
// parked car stretched across most of the lap (pit-wall thread 44, #1462: with
// two comparable laps the speed band's median fell to 35 km/h mid-lap).
//
// Plain JavaScript, no imports: analyze.mjs and its test both call it.

/**
 * The version of this rule, hashed into the sync fingerprint through
 * analyze.mjs blockVersions. 1: a lap whose distance trace opens more than 100 m
 * along the lap, or jumps more than 100 m in a tick, is partial (grid starts of
 * a race's lap 0, file-boundary slivers).
 */
export const GRID_LAP_VERSION = 1;

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
