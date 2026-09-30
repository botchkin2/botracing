// Do the field's world positions land on the drawn track? The map places a
// lap's Lat/Lon; cars come as game-world metres and go through the same
// projection (data/sessions/mapPlace.ts). This checks it on the player, who is
// in both: the median distance from the player's placed positions to the
// placed reference line. Plain TypeScript, no imports.
//
// Measured on the Daytona race (pit-wall thread 27 #813): 3-4 m raw against a
// reference lap, the rest being lap-distance pairing. A wrong georef or a
// resynced file with a different origin is tens of metres or more.

/** Above this the cars are not drawn: they would sit off the track. */
export const WORLD_MATCH_MAX_M = 15;

export interface WorldPoint {
  x: number;
  y: number;
}

function nearestM(p: WorldPoint, line: WorldPoint[]): number {
  let best = Infinity;
  for (const q of line) best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y));
  return best;
}

/**
 * Median distance from `player` points to the nearest vertex of `line`
 * (map metres); null with nothing to compare. The line's vertices are 5 m
 * apart on the grid, so the nearest vertex is within 2.5 m of the nearest
 * point on it. Every `step`-th player point is used.
 */
export function worldMatchM(
  player: WorldPoint[],
  line: WorldPoint[],
  step = 1,
): number | null {
  if (line.length === 0) return null;
  const d: number[] = [];
  for (let i = 0; i < player.length; i += Math.max(1, step)) {
    d.push(nearestM(player[i], line));
  }
  if (d.length === 0) return null;
  d.sort((a, b) => a - b);
  return d[d.length >> 1];
}

/** True when the field can be drawn on this map. */
export function worldMatches(medianM: number | null): boolean {
  return medianM !== null && medianM <= WORLD_MATCH_MAX_M;
}
