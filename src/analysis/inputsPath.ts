// The path the player's inputs are painted along in the 3D: his own world path through the field at each distance of
// the lap, so the ribbon and the car drawn at that distance are the same points (thread 94 #6333: the lap trace's GPS
// lat/lon is in the old surface frame, 2 to 7 m off the road and the cars). The colours stay the trace's own, indexed
// by the same grid. Plain TypeScript, imports one file.

import type {RaceClock} from './raceClock.ts';

/**
 * The world x/y of the player at distance i * stepM of lap `lapNumber`, for i in 0..count-1: the time he was there
 * (`clock.timeAtLapDistance`) through `pose`. Where he never got to a distance (a lap that ended in the pits) the
 * nearest point that exists stands in; null when no point does.
 */
export function lapPath(
  clock: RaceClock,
  lapNumber: number,
  count: number,
  stepM: number,
  pose: (timeS: number) => {x: number; y: number} | null,
): {x: number[]; y: number[]} | null {
  const x = new Array<number>(count).fill(NaN);
  const y = new Array<number>(count).fill(NaN);
  let any = false;
  for (let i = 0; i < count; i++) {
    const t = clock.timeAtLapDistance(lapNumber, i * stepM);
    const p = t === null ? null : pose(t);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    x[i] = p.x;
    y[i] = p.y;
    any = true;
  }
  if (!any) return null;
  let last = NaN;
  let lastY = NaN;
  for (let i = 0; i < count; i++) {
    if (Number.isNaN(x[i])) {
      x[i] = last;
      y[i] = lastY;
    } else {
      last = x[i];
      lastY = y[i];
    }
  }
  // the start of the lap, before his first point: the first one he has
  let first = 0;
  while (Number.isNaN(x[first])) first++;
  for (let i = 0; i < first; i++) {
    x[i] = x[first];
    y[i] = y[first];
  }
  return {x, y};
}
