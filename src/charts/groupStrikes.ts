/**
 * Strikes whose rings sit within a finger's reach of each other (screen
 * points) share one press target that reads all of them: three Warnings at
 * 503-507 m would otherwise stack their 44 pt targets and leave only the top
 * one tappable (bearing #5705). Greedy, in order: a point joins the first
 * group whose first point is within `within`.
 */
export function groupStrikes(
  points: {key: string; x: number; y: number}[],
  within: number,
): {keys: string[]; x: number; y: number}[] {
  const groups: {keys: string[]; x: number; y: number}[] = [];
  for (const p of points) {
    const g = groups.find(q => Math.hypot(q.x - p.x, q.y - p.y) <= within);
    if (g) g.keys.push(p.key);
    else groups.push({keys: [p.key], x: p.x, y: p.y});
  }
  return groups;
}
