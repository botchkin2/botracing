// The model channel of a car: its body edges are the class colour lightened by a step that belongs to the car's
// MODEL, so a model keeps its look in every session and two models of one family differ (carShapes gives the step
// inside the family; a model it does not know gets a stable step from its name). The fill and the hue stay the class's.
// Written meaning, one per channel (CODE_STANDARDS 4): fill = class, edge lightness = model, ring and light edges = the
// followed car. Plain TypeScript, no three.js.

/** Steps 0..5: 0 leaves the class colour, 5 is about 40 % of the way to white. */
export const TINT_STEPS = 6;
const PER_STEP = 0.08;

/** A stable step for a model name nothing else placed (a hash of the lower-cased name); 0 for no name. */
export function stepOfName(vehicle: string | null): number {
  const v = (vehicle ?? '').toLowerCase().trim();
  if (!v) return 0;
  let h = 0;
  for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) >>> 0;
  return h % TINT_STEPS;
}

/** '#rrggbb' lightened toward white by `step` (clamped to 0..TINT_STEPS - 1). Anything that is not '#rrggbb' comes back as it was. */
export function tintColor(color: string, step: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const s = Math.max(0, Math.min(TINT_STEPS - 1, Math.round(step)));
  const n = parseInt(m[1], 16);
  const lift = (c: number) => Math.round(c + (255 - c) * PER_STEP * s);
  const r = lift((n >> 16) & 255);
  const g = lift((n >> 8) & 255);
  const b = lift(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
