// Is a point on the pit lane? Plain TypeScript, no imports.
//
// The game's in-pits flag is not the pit lane: at the start of the Daytona race
// (thread 27, Botkin's desktop test) the whole field sits on the pit road with
// the flag at 0 for the first 7.6 s, 9.3 m from the racing line. The map has
// the pit lane's own geometry, so a car on it is in the pit lane whatever the
// flag says.

/** How far from the pit lane's centre line a car still counts as on it. A pit
 * lane is about 10 m wide (OSM draws its centre line). */
export const PIT_LANE_M = 6;

export interface PitPoint {
  x: number;
  y: number;
}

function distanceToSegmentM(p: PitPoint, a: PitPoint, b: PitPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0
      ? 0
      : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** True when `p` is within `maxM` of any of the lines (map metres). */
export function onPitLane(
  p: PitPoint,
  lines: PitPoint[][],
  maxM = PIT_LANE_M,
): boolean {
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      if (distanceToSegmentM(p, line[i - 1], line[i]) <= maxM) return true;
    }
  }
  return false;
}
