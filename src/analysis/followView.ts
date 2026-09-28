// Follow map view (handoff v2 M1b): a heading-up chase view around the
// cursor whose zoom follows the chart window. Inputs are metres east/north
// (y up); outputs are screen points (y down).
//
// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.

export interface FollowXy {
  x: number;
  y: number;
}

// Visible track length is 0.95 × the chart window's span, held to 50–360 m.
// A whole-lap window has no span, so it uses the prototype's 260 m.
export const FOLLOW_MIN_M = 50;
export const FOLLOW_MAX_M = 360;
export const FOLLOW_WHOLE_LAP_M = 260;
const FOLLOW_FACTOR = 0.95;

// The car sits at 64% of the height, so more of the road ahead shows.
export const FOLLOW_ANCHOR_Y = 0.64;
// Road drawn behind and ahead of the car, as fractions of the visible span.
export const FOLLOW_BEHIND = 0.7;
export const FOLLOW_AHEAD = 0.95;

/** Metres of track that fill the box height, from the chart window's span. */
export function followVisibleM(windowSpanM: number | null): number {
  if (windowSpanM == null) return FOLLOW_WHOLE_LAP_M;
  return Math.max(
    FOLLOW_MIN_M,
    Math.min(FOLLOW_MAX_M, windowSpanM * FOLLOW_FACTOR),
  );
}

/** Direction of travel in radians (atan2, east = 0, north = π/2). */
export function headingRad(from: FollowXy, to: FollowXy): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

export interface FollowView {
  centre: FollowXy;
  headingRad: number;
  visibleM: number;
  width: number;
  height: number;
}

/** Points per metre on screen. */
export function followScale(v: FollowView): number {
  return v.height / v.visibleM;
}

/**
 * Maps metres to screen points: the centre lands at (width/2, 64% height)
 * and the heading points straight up.
 */
export function followProject(v: FollowView): (p: FollowXy) => FollowXy {
  const sc = followScale(v);
  // Turn the heading onto north (π/2), then flip y for the screen.
  const turn = Math.PI / 2 - v.headingRad;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const ox = v.width / 2;
  const oy = v.height * FOLLOW_ANCHOR_Y;
  return p => {
    const dx = p.x - v.centre.x;
    const dy = p.y - v.centre.y;
    return {
      x: ox + (dx * cos - dy * sin) * sc,
      y: oy - (dx * sin + dy * cos) * sc,
    };
  };
}

/**
 * The same projection as an SVG matrix(a b c d e f), so world-space paths
 * can be built once and moved per frame by one transform.
 */
export function followMatrix(
  v: FollowView,
): [number, number, number, number, number, number] {
  const sc = followScale(v);
  const turn = Math.PI / 2 - v.headingRad;
  const a = sc * Math.cos(turn);
  const b = -sc * Math.sin(turn);
  const c = -sc * Math.sin(turn);
  const d = -sc * Math.cos(turn);
  const ox = v.width / 2;
  const oy = v.height * FOLLOW_ANCHOR_Y;
  return [
    a,
    b,
    c,
    d,
    ox - a * v.centre.x - c * v.centre.y,
    oy - b * v.centre.x - d * v.centre.y,
  ];
}

// Brake on above 10%, off again below 5%: a trail-brake that hovers around
// 10% gives one onset, not one per wobble.
const BRAKE_ON_PCT = 10;
const BRAKE_OFF_PCT = 5;

/** Distances where the brake goes on, over the whole trace. */
export function brakeOnsetsM(
  distanceM: number[],
  brakePct: number[],
): number[] {
  const out: number[] = [];
  let on = brakePct.length > 0 && brakePct[0] > BRAKE_ON_PCT;
  for (let i = 1; i < brakePct.length; i++) {
    if (!on && brakePct[i] > BRAKE_ON_PCT) {
      on = true;
      out.push(distanceM[i]);
    } else if (on && brakePct[i] < BRAKE_OFF_PCT) on = false;
  }
  return out;
}
