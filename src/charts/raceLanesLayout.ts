// Where the YOUR RACE lanes' marks go: race time to x in the lane area, spans
// clipped to the window. Pure, so it is tested without a renderer.
import type {RaceLanes, Span} from '@/src/analysis/raceLanes';

export const LANE_ORDER = ['pit', 'tow', 'battle', 'blue', 'pass'] as const;
export type LaneKey = (typeof LANE_ORDER)[number];

export const LANE_LABEL: Record<LaneKey, string> = {
  pit: 'PIT',
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
  const clipped = (spans: Span[]) =>
    spans
      .filter(s => s.toS > window.fromS && s.fromS < window.toS)
      .map(s => {
        const x = xOf(Math.max(s.fromS, window.fromS));
        // A span shorter than a pixel still draws.
        return {x, w: Math.max(1, xOf(Math.min(s.toS, window.toS)) - x)};
      });
  const spanLane = {
    pit: lanes.pit,
    tow: lanes.tow,
    battle: lanes.battle,
  } as Partial<Record<LaneKey, Span[]>>;

  return {
    rows: LANE_ORDER.map((key, i) => ({
      key,
      label: LANE_LABEL[key],
      y: i * laneHeight,
      spans: clipped(spanLane[key] ?? []),
      ticks: key === 'blue' ? lanes.blueS.filter(inside).map(xOf) : [],
      marks:
        key === 'pass'
          ? lanes.passes
              .filter(p => inside(p.timeS))
              .map(p => ({x: xOf(p.timeS), made: p.made}))
          : [],
    })),
    lapLines: lanes.lapStartsS
      .map((t, i) => ({t, lap: i + 1}))
      .filter(l => inside(l.t))
      .map(l => ({
        x: xOf(l.t),
        label: l.lap % lapLabelEvery === 0 ? `${l.lap}` : null,
      })),
    height: LANE_ORDER.length * laneHeight,
  };
}
