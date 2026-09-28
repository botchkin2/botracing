// The chart window: a short stretch of the lap around the cursor, so corner
// detail is readable (handoff §3 "Window"). Works on a GridTrace-shaped
// reference: distances every stepM metres and elapsed time at each.
//
// Time mode: ±win/2 seconds of the reference lap around the cursor. The x
// axis is the reference's elapsed time, so the scale never changes while
// playing; the metres shown widen on straights and tighten in slow corners.
// Distance mode: win metres centred on the cursor, x linear in metres.
// Both keep their size and the cursor centred at the line: the part outside
// the lap is blank.
//
// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.

export interface TimedGrid {
  stepM: number;
  distanceM: number[];
  timeS: number[];
}

export type WindowMode = 'time' | 'distance';

// Window steps from the handoff; the bold defaults are 2 s and 200 m.
export const TIME_STEPS_S = [0.5, 1, 2, 4];
export const DISTANCE_STEPS_M = [50, 100, 200, 400];
export const DEFAULT_WINDOW = {time: 2, distance: 200};

// Elapsed time on the reference at a distance (linear between grid points).
export function timeAtDistance(ref: TimedGrid, m: number): number {
  const last = ref.distanceM.length - 1;
  const x = Math.max(0, Math.min(last, m / ref.stepM));
  const i = Math.min(last - 1, Math.floor(x));
  const f = x - i;
  return ref.timeS[i] + (ref.timeS[i + 1] - ref.timeS[i]) * f;
}

// Distance on the reference at an elapsed time (binary search, then linear).
export function distanceAtTime(ref: TimedGrid, t: number): number {
  const ts = ref.timeS;
  const last = ts.length - 1;
  if (t <= ts[0]) return 0;
  if (t >= ts[last]) return ref.distanceM[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - ts[lo]) / (ts[hi] - ts[lo] || 1);
  return ref.distanceM[lo] + (ref.distanceM[hi] - ref.distanceM[lo]) * f;
}

// [start, end] in metres. `win` is seconds (time) or metres (distance);
// null means the whole lap. Distance mode is centred and may run past the
// line (blank there). Time mode's metres are clipped to the lap; its x axis
// is windowTimeS.
export function windowRange(
  ref: TimedGrid,
  cursorM: number,
  mode: WindowMode,
  win: number | null,
): [number, number] {
  const lengthM = ref.distanceM[ref.distanceM.length - 1];
  if (win == null) return [0, lengthM];
  if (mode === 'distance') return [cursorM - win / 2, cursorM + win / 2];
  const [t0, t1] = windowTimeS(ref, cursorM, win);
  return [distanceAtTime(ref, t0), distanceAtTime(ref, t1)];
}

// Time mode's x axis in seconds of the reference lap: always win wide and
// centred on the cursor, even past the line.
export function windowTimeS(
  ref: TimedGrid,
  cursorM: number,
  win: number,
): [number, number] {
  const t = timeAtDistance(ref, cursorM);
  return [t - win / 2, t + win / 2];
}

// Reference time at grid index i, extended past the lap end at the last
// step's pace, so a longer lap still has a place on the time axis.
export function timeAtIndex(ref: TimedGrid, i: number): number {
  const ts = ref.timeS;
  const last = ts.length - 1;
  if (i <= last) return ts[Math.max(0, i)];
  return ts[last] + (i - last) * (ts[last] - ts[last - 1]);
}

// Gridline step for time mode, from the lap's average speed rather than the
// metres in view, so the step doesn't flip while playing.
export function timeGridStepM(
  ref: TimedGrid,
  win: number,
  widthPt: number,
): number {
  const lapS = ref.timeS[ref.timeS.length - 1] || 1;
  const lengthM = ref.distanceM[ref.distanceM.length - 1];
  return gridStepM((lengthM / lapS) * win, widthPt);
}

// Moves the cursor for a drag of dx points over a chart `widthPt` wide. The
// traces move under a fixed cursor, so dragging right goes back in the lap.
export function panCursor(
  ref: TimedGrid,
  cursorM: number,
  mode: WindowMode,
  win: number,
  dx: number,
  widthPt: number,
): number {
  const lengthM = ref.distanceM[ref.distanceM.length - 1];
  const frac = -dx / widthPt;
  const next =
    mode === 'distance'
      ? cursorM + frac * win
      : distanceAtTime(ref, timeAtDistance(ref, cursorM) + frac * win);
  return Math.max(0, Math.min(lengthM, next));
}

// Distance gridline step: the smallest nice step that leaves at least
// minGapPt between lines.
const NICE_STEPS_M = [5, 10, 20, 25, 50, 100, 200, 500, 1000];
export function gridStepM(
  spanM: number,
  widthPt: number,
  minGapPt = 48,
): number {
  for (const s of NICE_STEPS_M) if ((s / spanM) * widthPt >= minGapPt) return s;
  return NICE_STEPS_M[NICE_STEPS_M.length - 1];
}

// Advances playback by wall-clock seconds at a rate, looping at the lap end.
export function playStep(
  ref: TimedGrid,
  cursorM: number,
  dtS: number,
  rate: number,
): number {
  const lapS = ref.timeS[ref.timeS.length - 1];
  let t = timeAtDistance(ref, cursorM) + dtS * rate;
  if (t >= lapS) t -= lapS;
  return distanceAtTime(ref, t);
}
