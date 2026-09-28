// Which side of a closed track line is inside the loop. Uses the loop's
// winding (the sign of its shoelace area), so it is right on concave parts
// too, where "towards the middle of the map" points the wrong way.
//
// Screen coordinates, y down. Plain TypeScript, no imports: Node runs it.

export interface SidePoint {
  x: number;
  y: number;
}

/** Twice the signed area; positive means clockwise on screen (y down). */
export function signedArea2(points: SidePoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/**
 * A point `offset` off the line at `at`, square to the direction prev→next.
 * Positive offset is inside the loop, negative outside. `clockwise` is
 * signedArea2(loop) > 0.
 */
export function offsetFromLine(
  prev: SidePoint,
  at: SidePoint,
  next: SidePoint,
  offset: number,
  clockwise: boolean,
): SidePoint {
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  // Right-hand normal on a y-down screen; inside when the loop is clockwise.
  const sign = clockwise ? 1 : -1;
  return {
    x: at.x + (-dy / len) * offset * sign,
    y: at.y + (dx / len) * offset * sign,
  };
}

/** Even–odd point-in-polygon. */
export function insidePolygon(p: SidePoint, polygon: SidePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

/** Shortest distance from p to any vertex of the line (dense lines only). */
export function nearestVertexDistance(p: SidePoint, line: SidePoint[]): number {
  let best = Infinity;
  for (const q of line) best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y));
  return best;
}
