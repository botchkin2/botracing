// One finger in the phone's 3D box, inside the Android app's WebView (pit-wall thread 106, ticket #46). A drag is the
// camera's or the page's, decided once from its first travel: a mostly horizontal drag turns the camera, a steeper
// one scrolls the app's page. The WebView takes its touches whole (nestedScrollEnabled), so a vertical drag only
// reaches the page's ScrollView if the 3D page forwards it over the bridge, summed once a frame, with the fling a
// native scroll would have. Plain TypeScript, no imports.

/** Past this angle from the horizontal a drag is the page's: a thumb drifts about 20° on a sideways drag. */
export const SCROLL_MIN_ANGLE_DEG = 35;
/** The drag's travel from its first touch before it is classified: a little over Android's touch slop (8 dp). */
export const DECIDE_TRAVEL_PX = 10;
/** The fling's time constant, ms: a 2000 px/s lift travels 2000 x 0.4 = 800 px. */
export const FLING_TAU_MS = 400;
/** A lift slower than this (px/ms) is a stop, not a fling; a fling ends below it too. */
export const FLING_MIN_SPEED = 0.05;
export const FLING_MAX_SPEED = 6;
/** The lift's speed is read over the last stretch of the drag, ms. */
const VELOCITY_WINDOW_MS = 100;
/** A frame this late (a hidden tab, a stall) advances the fling by no more than this, ms. */
const MAX_FRAME_MS = 64;

const TAN_MIN = Math.tan((SCROLL_MIN_ANGLE_DEG * Math.PI) / 180);

export type DragKind = 'undecided' | 'camera' | 'scroll';

/** A drag of (dx, dy) from where it began: the page's when its angle from the horizontal is past the threshold. */
export function classifyDrag(dx: number, dy: number): 'camera' | 'scroll' {
  return Math.abs(dy) > Math.abs(dx) * TAN_MIN ? 'scroll' : 'camera';
}

/** One step of the fling: the distance travelled in `dtMs` at speed `v` (px/ms) and the speed after it. */
export function flingStep(v: number, dtMs: number): {dy: number; v: number} {
  const k = Math.exp(-dtMs / FLING_TAU_MS);
  return {dy: v * FLING_TAU_MS * (1 - k), v: v * k};
}

type Gesture = {x0: number; y0: number; lastX: number; lastY: number; kind: DragKind; samples: {t: number; y: number}[]};

/**
 * The state of one drag. `down`, `move`, `up` and `cancel` are the pointer's events (`t` is its time stamp in ms);
 * `frame` is called once per animation frame and returns the page scroll to send: every scroll drag's travel since the
 * last frame, plus the fling after a lift. `move` returns the horizontal distance the camera is to turn by (always
 * 0 for a scroll drag). A cancelled pointer (the browser took the gesture, or capture was lost) ends the drag at once:
 * later moves do nothing, so a half drag never leaves the camera held.
 */
export function createPanRule() {
  let g: Gesture | null = null;
  let pendingDy = 0;
  let fling: {v: number; at: number} | null = null;
  return {
    down(x: number, y: number, t: number): void {
      fling = null;
      g = {x0: x, y0: y, lastX: x, lastY: y, kind: 'undecided', samples: [{t, y}]};
    },
    move(x: number, y: number, t: number): number {
      if (g === null) return 0;
      g.samples.push({t, y});
      while (g.samples.length > 2 && t - g.samples[0].t > VELOCITY_WINDOW_MS) g.samples.shift();
      if (g.kind === 'undecided') {
        const dx = x - g.x0;
        const dy = y - g.y0;
        if (Math.hypot(dx, dy) < DECIDE_TRAVEL_PX) return 0;
        g.kind = classifyDrag(dx, dy);
        g.lastX = g.x0;
        g.lastY = g.y0;
      }
      const dx = x - g.lastX;
      const dy = y - g.lastY;
      g.lastX = x;
      g.lastY = y;
      if (g.kind === 'scroll') {
        pendingDy += dy;
        return 0;
      }
      return dx;
    },
    up(t: number): void {
      if (g !== null && g.kind === 'scroll') {
        const last = g.samples[g.samples.length - 1];
        const first = g.samples[0];
        const span = last.t - first.t;
        const v = span > 0 && t - last.t <= VELOCITY_WINDOW_MS ? (last.y - first.y) / span : 0;
        if (Math.abs(v) >= FLING_MIN_SPEED) fling = {v: Math.sign(v) * Math.min(Math.abs(v), FLING_MAX_SPEED), at: t};
      }
      g = null;
    },
    cancel(): void {
      g = null;
      fling = null;
    },
    frame(t: number): number {
      let dy = pendingDy;
      pendingDy = 0;
      if (fling !== null) {
        const step = flingStep(fling.v, Math.min(Math.max(0, t - fling.at), MAX_FRAME_MS));
        dy += step.dy;
        fling = Math.abs(step.v) < FLING_MIN_SPEED ? null : {v: step.v, at: t};
      }
      return dy;
    },
    /** True while a finger is down, or a fling still moves the page. */
    get busy(): boolean {
      return g !== null || fling !== null || pendingDy !== 0;
    },
  };
}
