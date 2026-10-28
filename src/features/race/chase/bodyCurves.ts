// The curves a real body is made of (ticket 59, real bodies, pit-wall thread 124 #8288-#8297): a side profile (the
// underbody, the beltline and the top line along the car), a plan view (the half-width along the car, with the arch
// flares) and a greenhouse, sampled at stations and turned into rounded cross-sections. Pure numbers, no three.js:
// bodyMesh.ts lofts them, featureLines.ts draws the outline. x is metres along the car from its centre, + forward.

/** A control point of a curve: x along the car, v the value there (a height or a half-width, metres). */
export type CurvePoint = [x: number, v: number];

export interface Greenhouse {
  /** The windscreen's foot, on the belt (x). */
  screenBaseX: number;
  /** Where the roof panel starts and ends (x): the windscreen runs up to roofFrontX, the rear window down from roofRearX. */
  roofFrontX: number;
  roofRearX: number;
  /** The rear window's foot, on the deck (x). */
  rearBaseX: number;
  /** The roof panel's half-width, metres. */
  roofHalfW: number;
}

/** One body, as numbers. Every curve lists its points in any order; x is the body frame (+ forward, centre of the length 0). */
export interface BodyModel {
  lengthM: number;
  /** The wheel centres' x. */
  frontAxleX: number;
  rearAxleX: number;
  /** The body's underside (sill, splitter lip, diffuser). */
  bottom: CurvePoint[];
  /** The widest line of the flank, as a height: the belt. */
  belt: CurvePoint[];
  /** The top line along the centre: nose, hood, windscreen, roof, rear window, deck, tail. */
  top: CurvePoint[];
  /** The half-width at the belt: nose taper, the flares over the axles, the waist, the tail. */
  half: CurvePoint[];
  greenhouse: Greenhouse;
  /** The hood and deck's top half-width as a share of the belt's (their flanks tumble in); default HOOD_RATIO. */
  hoodRatio?: number;
  /** The same share along the car, outside the greenhouse, where it varies: a narrow engine deck between wide haunches, a rounded tail. */
  topRatio?: CurvePoint[];
  /** How square the shoulder is: 2 is an ellipse, larger is boxier; default SHOULDER_ROUNDNESS. */
  roundness?: number;
}

/** What one station of the body is: the heights and half-widths its section is built from. */
export interface BodyStation {
  x: number;
  sill: number;
  belt: number;
  top: number;
  /** Half-width at the belt (the widest). */
  half: number;
  /** Half-width at the top edge: the roof's in the greenhouse, the hood's or deck's outside it. */
  topHalf: number;
  /** Half-width at the sill. */
  sillHalf: number;
}

export const STATIONS = 28;
export const HOOD_RATIO = 0.86;
export const SILL_RATIO = 0.88;
export const SHOULDER_ROUNDNESS = 2.6;
/** Points of a section's shoulder arc, between the belt and the top edge. */
export const SHOULDER_POINTS = 3;
/** The top of a section is crowned by this much at the centre line. */
export const CROWN_M = 0.012;
/** A section keeps at least this much between its belt and its top, so the shoulder arc never inverts. */
const MIN_SHOULDER_M = 0.03;

/** Points sorted by x ascending; a curve needs two or more distinct x. */
function sorted(points: CurvePoint[]): CurvePoint[] {
  return [...points].sort((a, b) => a[0] - b[0]);
}

/**
 * The curve's value at x: a monotone cubic through its points (Fritsch-Carlson), so it never overshoots a control point,
 * with its ends clamped (outside the points it holds the end value).
 */
export function sampleCurve(points: CurvePoint[], x: number): number {
  const p = sorted(points);
  const n = p.length;
  if (x <= p[0][0]) return p[0][1];
  if (x >= p[n - 1][0]) return p[n - 1][1];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++)
    d.push((p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0]));
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++)
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  let i = 0;
  while (x > p[i + 1][0]) i++;
  const h = p[i + 1][0] - p[i][0];
  const t = (x - p[i][0]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * p[i][1] +
    (t3 - 2 * t2 + t) * h * m[i] +
    (-2 * t3 + 3 * t2) * p[i + 1][1] +
    (t3 - t2) * h * m[i + 1]
  );
}

/** `n` samples of the curve, evenly spaced in x from its first point to its last: [x, value]. */
export function spline(points: CurvePoint[], n: number): CurvePoint[] {
  const p = sorted(points);
  const x0 = p[0][0];
  const x1 = p[p.length - 1][0];
  const out: CurvePoint[] = [];
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / (n - 1);
    out.push([x, sampleCurve(p, x)]);
  }
  return out;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** The top edge's half-width at x: the hood's or deck's share of the belt outside the greenhouse, the roof panel inside it. */
function topHalfAt(model: BodyModel, x: number, half: number): number {
  const g = model.greenhouse;
  const outside =
    half *
    (model.topRatio
      ? sampleCurve(model.topRatio, x)
      : model.hoodRatio ?? HOOD_RATIO);
  const roof = Math.min(g.roofHalfW, half * 0.95);
  if (x >= g.screenBaseX || x <= g.rearBaseX) return outside;
  if (x >= g.roofFrontX) {
    // the windscreen: from the hood's width at its foot to the roof's at its head
    const t = smooth(
      clamp01((g.screenBaseX - x) / (g.screenBaseX - g.roofFrontX)),
    );
    return outside + (roof - outside) * t;
  }
  if (x >= g.roofRearX) return roof;
  const t = smooth(clamp01((x - g.rearBaseX) / (g.roofRearX - g.rearBaseX)));
  return outside + (roof - outside) * t;
}

/** The station at x. */
export function stationAt(model: BodyModel, x: number): BodyStation {
  const sill = sampleCurve(model.bottom, x);
  const top = Math.max(sampleCurve(model.top, x), sill + 2 * MIN_SHOULDER_M);
  const belt = Math.min(
    Math.max(sampleCurve(model.belt, x), sill + MIN_SHOULDER_M),
    top - MIN_SHOULDER_M,
  );
  const half = sampleCurve(model.half, x);
  return {
    x,
    sill,
    belt,
    top,
    half,
    topHalf: topHalfAt(model, x, half),
    sillHalf: half * SILL_RATIO,
  };
}

/**
 * `n` stations from the nose (x = +length / 2) to the tail, spaced by a cosine so the ends, where the body curves most,
 * get the most of them.
 */
export function bodyStations(
  model: BodyModel,
  n: number = STATIONS,
): BodyStation[] {
  const out: BodyStation[] = [];
  for (let i = 0; i < n; i++) {
    const x = (model.lengthM / 2) * Math.cos((Math.PI * i) / (n - 1));
    out.push(stationAt(model, x));
  }
  return out;
}

/**
 * One station's cross-section as [z, y] points, the left flank (z < 0) first: up from the sill along the lower flank to
 * the belt, round the shoulder (a superellipse arc) to the top edge, across the crowned top, and down the right flank.
 * Symmetric about z = 0, with 2 * (3 + SHOULDER_POINTS + 1) + 1 points.
 */
export function sectionRing(
  st: BodyStation,
  roundness: number = SHOULDER_ROUNDNESS,
): [z: number, y: number][] {
  const left: [number, number][] = [
    [-st.sillHalf, st.sill],
    [-st.half * 0.99, st.sill + 0.4 * (st.belt - st.sill)],
    [-st.half, st.belt],
  ];
  const e = 2 / roundness;
  for (let k = 1; k <= SHOULDER_POINTS; k++) {
    const a = ((Math.PI / 2) * k) / (SHOULDER_POINTS + 1);
    left.push([
      -(st.topHalf + (st.half - st.topHalf) * Math.pow(Math.cos(a), e)),
      st.belt + (st.top - st.belt) * Math.pow(Math.sin(a), e),
    ]);
  }
  left.push([-st.topHalf, st.top]);
  const right = left.map(([z, y]) => [-z, y] as [number, number]).reverse();
  return [...left, [0, st.top + CROWN_M], ...right];
}
