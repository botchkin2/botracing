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
 * Distances where the brake goes on (crosses above thresholdPct from at or
 * below it), between fromM and toM.
 */
export function brakeOnsetsM(
  distanceM: number[],
  brakePct: number[],
  fromM: number,
  toM: number,
  thresholdPct = 10,
): number[] {
  const out: number[] = [];
  for (let i = 1; i < brakePct.length; i++) {
    const m = distanceM[i];
    if (m < fromM || m > toM) continue;
    if (brakePct[i] > thresholdPct && brakePct[i - 1] <= thresholdPct)
      out.push(m);
  }
  return out;
}
