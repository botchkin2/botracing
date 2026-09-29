// Where each numbered corner badge goes on the Track page map. A badge
// sits outside the loop at the design offset. When that spot runs off the
// map or covers an earlier badge (tight complexes: Spa's Bus Stop), it tries
// further out, then inside the loop, and keeps the first spot that is clear.
// If none is clear it takes the least-overlapping spot, clamped onto the
// map, so every corner keeps a badge the list can point at.
//
// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.

export interface BadgePoint {
  x: number;
  y: number;
}

export interface BadgeBox {
  width: number;
  height: number;
  /** Badge diameter; also the minimum centre-to-centre gap. */
  d: number;
}

/**
 * For each badge in order, candidate centres from best to worst; returns
 * one centre per badge.
 */
export function placeBadges(
  candidates: BadgePoint[][],
  box: BadgeBox,
): BadgePoint[] {
  const r = box.d / 2;
  const clamp = (p: BadgePoint): BadgePoint => ({
    x: Math.min(box.width - r - 1, Math.max(r + 1, p.x)),
    y: Math.min(box.height - r - 1, Math.max(r + 1, p.y)),
  });
  const onMap = (p: BadgePoint) =>
    p.x >= r + 1 &&
    p.x <= box.width - r - 1 &&
    p.y >= r + 1 &&
    p.y <= box.height - r - 1;
  const placed: BadgePoint[] = [];
  for (const options of candidates) {
    let best: BadgePoint | null = null;
    let bestOverlap = Infinity;
    for (const raw of options) {
      const p = clamp(raw);
      let overlap = 0;
      for (const q of placed) {
        overlap += Math.max(0, box.d - Math.hypot(p.x - q.x, p.y - q.y));
      }
      if (onMap(raw) && overlap === 0) {
        best = p;
        break;
      }
      if (overlap < bestOverlap) {
        best = p;
        bestOverlap = overlap;
      }
    }
    placed.push(best ?? {x: r + 1, y: r + 1});
  }
  return placed;
}
