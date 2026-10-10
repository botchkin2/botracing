// Where the YOUR RACE lanes' marks go: race time to x in the lane area, spans
// clipped to the window. Pure, so it is tested without a renderer.
import type {RaceLanes, Span} from '@/src/analysis/raceLanes';

export const LANE_ORDER = [
  'pit',
  'off',
  'tow',
  'battle',
  'blue',
  'pass',
] as const;
// Wide enough to see and to tap at a glance on a 375 pt strip.
export const OFF_MIN_W = 3;

export type LaneKey = (typeof LANE_ORDER)[number];

export const LANE_LABEL: Record<LaneKey, string> = {
  pit: 'PIT',
  off: 'OFF',
  tow: 'TOW',
  battle: 'BATTLE',
  blue: 'BLUE',
  pass: 'PASS',
};

export interface LanesLayout {
  rows: {
    key: LaneKey;
    label: string;
    y: number;
    spans: {x: number; w: number}[];
    /** Blue-flag onsets. */
    ticks: number[];
    /** Passes; `made` draws up, lost draws down. */
    marks: {x: number; made: boolean}[];
  }[];
  lapLines: {x: number; label: string | null}[];
  /** Total drawn height. */
  height: number;
}

/** Race time at x (pixels from the left of the lane area), clamped to the window. */
export function timeAtX(x: number, window: Span, laneWidth: number): number {
  const f = Math.min(1, Math.max(0, x / laneWidth));
  return window.fromS + f * (window.toS - window.fromS);
}

export interface ScrubInputs {
  window: Span;
  laneWidth: number;
  labelWidth: number;
  onScrub: (timeS: number) => void;
}

/**
 * A drag on the lanes. The zoomed windows follow the playhead, so the window
 * moves under the finger as the playhead moves; mapping each move through the
 * moved window makes the playhead run away (camber, pit-wall thread 27 #970).
 * The window at the start of the drag is the one every move of that drag is
 * mapped through. `read` returns the latest inputs (a ref in the component).
 */
export function laneScrubber(read: () => ScrubInputs) {
  let frozen: Span | null = null;
  const move = (x: number) => {
    const p = read();
    p.onScrub(timeAtX(x - p.labelWidth, frozen ?? p.window, p.laneWidth));
  };
  return {
    start(x: number) {
      frozen = read().window;
      move(x);
    },
    move,
    end() {
      frozen = null;
    },
  };
}

export function lanesLayout({
  lanes,
  window,
  laneWidth,
  laneHeight,
  lapLabelEvery,
}: {
  lanes: RaceLanes;
  window: Span;
  laneWidth: number;
  laneHeight: number;
  lapLabelEvery: number;
}): LanesLayout {
  const widthS = window.toS - window.fromS;
  const xOf = (t: number) => ((t - window.fromS) / widthS) * laneWidth;
  const inside = (t: number) => t >= window.fromS && t <= window.toS;
  const clipped = (spans: Span[], minW: number) =>
    spans
      .filter(s => s.toS > window.fromS && s.fromS < window.toS)
      .map(s => {
        const x = xOf(Math.max(s.fromS, window.fromS));
        // A span shorter than minW still draws: a 0.2 s off is sub-pixel over a race.
        return {x, w: Math.max(minW, xOf(Math.min(s.toS, window.toS)) - x)};
      });
  const spanLane = {
    pit: lanes.pit,
    tow: lanes.tow,
    battle: lanes.battle,
    off: lanes.off,
  } as Partial<Record<LaneKey, Span[]>>;

  return {
    rows: LANE_ORDER.map((key, i) => ({
      key,
      label: LANE_LABEL[key],
      y: i * laneHeight,
      spans: clipped(spanLane[key] ?? [], key === 'off' ? OFF_MIN_W : 1),
      ticks: key === 'blue' ? lanes.blueS.filter(inside).map(xOf) : [],
      marks:
        key === 'pass'
          ? lanes.passes
              .filter(p => inside(p.timeS))
              .map(p => ({x: xOf(p.timeS), made: p.made}))
          : [],
    })),
    lapLines: lanes.lapStarts
      .filter(l => inside(l.timeS))
      .map(l => ({
        x: xOf(l.timeS),
        label: l.lap % lapLabelEvery === 0 ? `${l.lap}` : null,
      })),
    height: LANE_ORDER.length * laneHeight,
  };
}
