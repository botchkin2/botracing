// The model channel of a car: its body edges are one of PAINTS colours inside its class's band, so a model keeps its
// look in every session and two models of one class differ by a colour, not by a lightness step (ticket 59, piece 2;
// pit-wall thread 124 #8063, #8065 point 5, #8102). Written meaning, one per channel (CODE_STANDARDS 4): fill = class,
// edge colour = model, ring and white edges = the followed car. Plain TypeScript, no three.js.
//
// The three class tokens are close (Hyper and GT3 are 13.6 ΔE apart in OKLab), so a class's band is not a ring of
// hues: it spreads each model away from the nearest other class, in hue (three steps) and in lightness (two rows).
// `paintGaps` measures what that leaves, and carPaint.test.ts holds it.

/** Models per class that get their own colour; a seventh shares one (a different body family tells them apart). */
export const PAINTS = 6;
const HUE_STEPS = 3;
const HUE_STEP_DEG = 20;
const LIGHT_ROW = 0.06;
/** The second row also turns a little further and is a little more chroma, so a pale colour stays inside its band. */
const ROW_HUE_DEG = 6;
const ROW_CHROMA = 0.02;

type Lab = [number, number, number];

const linear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const gamma = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

/** '#rrggbb' as OKLab (L 0..1, a and b about ±0.4), or null for anything else. */
export function toOklab(hex: string): Lab | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = linear(((n >> 16) & 255) / 255);
  const g = linear(((n >> 8) & 255) / 255);
  const b = linear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s,
  ];
}

/** OKLab as '#rrggbb', or null when it lies outside sRGB. */
function fromOklab([L, a, b]: Lab): string | null {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  if (rgb.some(v => v < -0.0005 || v > 1.0005)) return null;
  const bytes = rgb.map(v =>
    Math.round(255 * gamma(Math.max(0, Math.min(1, v)))),
  );
  return `#${bytes.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The distance between two '#rrggbb' colours in OKLab, ×100 (about 2 is the least a viewer can tell apart). */
export function colorGap(a: string, b: string): number {
  const x = toOklab(a);
  const y = toOklab(b);
  if (!x || !y) return Infinity;
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

const hueOf = ([, a, b]: Lab) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
const turn = (from: number, to: number) => ((to - from + 540) % 360) - 180;

/** A stable index for a model name nothing else placed (a hash of the lower-cased name); 0 for no name. */
export function stepOfName(vehicle: string | null): number {
  const v = (vehicle ?? '').toLowerCase().trim();
  if (!v) return 0;
  let h = 0;
  for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) >>> 0;
  return h % PAINTS;
}

/**
 * The edge colour of the model at `index` (0..PAINTS - 1, clamped) in the class whose colour is `anchor`. `rivals` are
 * the other classes' colours: the hue turns away from the nearest of them, because moving toward it is the only way a
 * colour stops reading as its own class. Index 0 is the class colour itself. Anything that is not '#rrggbb' comes back
 * as it was; with no rival the hue turns up.
 */
export function modelPaint(
  anchor: string,
  rivals: string[],
  index: number,
): string {
  const lab = toOklab(anchor);
  if (!lab) return anchor;
  const i = Number.isFinite(index)
    ? Math.max(0, Math.min(PAINTS - 1, Math.round(index)))
    : 0;
  if (i === 0) return anchor;
  const hue = hueOf(lab);
  const chroma = Math.hypot(lab[1], lab[2]);
  let sign = 1;
  let nearest = 360;
  for (const r of rivals) {
    const other = toOklab(r);
    if (!other) continue;
    const t = turn(hue, hueOf(other));
    if (Math.abs(t) < nearest) {
      nearest = Math.abs(t);
      sign = t > 0 ? -1 : 1;
    }
  }
  const row = Math.floor(i / HUE_STEPS);
  const h =
    hue + sign * (HUE_STEP_DEG * (i % HUE_STEPS) + ROW_HUE_DEG * row);
  const L = lab[0] + LIGHT_ROW * row;
  const C = chroma + ROW_CHROMA * row;
  // pull the chroma in until the colour fits sRGB; the hue and lightness stay what the model asked for
  for (let t = 1; t > 0; t -= 0.01) {
    const rad = (h * Math.PI) / 180;
    const hex = fromOklab([L, C * t * Math.cos(rad), C * t * Math.sin(rad)]);
    if (hex) return hex;
  }
  return anchor;
}
