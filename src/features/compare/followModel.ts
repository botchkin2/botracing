import {
  brakeOnsetsM,
  FOLLOW_AHEAD,
  FOLLOW_BEHIND,
  followVisibleM,
  headingRad,
} from '@/src/analysis/followView';
import {type GridTrace, gridIndex} from '@/src/analysis/resample';

// The Follow map's data (handoff v2 M1b): road around the cursor at full
// grid resolution, each lap's own line, and a tick where each lap braked.
// Pure; metres east/north on the same origin as the Track map.

type Xy = {x: number; y: number};

type FollowLapRef = {
  lapId: string;
  selIndex: number;
  key: boolean;
  highlighted: boolean;
};

export type FollowModel = {
  centre: Xy;
  headingRad: number;
  visibleM: number;
  /** Road band centrelines: the OSM outline, or the reference's own line. */
  band: Xy[][];
  lines: (FollowLapRef & {points: Xy[]})[];
  /** Short cross-track ticks, [left, right] ends. */
  brakeTicks: (FollowLapRef & {ends: [Xy, Xy]})[];
  /** Whole reference lap and the cursor, for the inset. */
  inset: {line: Xy[]; at: Xy};
};

// Heading from the reference ±15 m around the cursor (the prototype's ±3
// samples on its 5 m grid).
const HEADING_HALF_M = 15;
// Brake ticks are 4.8 m across the lap's line, from the prototype.
const TICK_HALF_M = 2.4;
// Extra road past the visible span, so rotation never shows a cut end.
const MARGIN_M = 40;
const INSET_STRIDE = 4;

export function buildFollowModel(input: {
  refTrace: GridTrace;
  traces: Map<string, GridTrace>;
  /** Laps drawn on the map, back to front. */
  shown: FollowLapRef[];
  cursorM: number;
  /** Chart window span in metres; null for the whole lap. */
  windowSpanM: number | null;
  /** OSM track lines, already in map metres; empty to use the driven line. */
  outline: Xy[][];
  /** lat/lon → map metres for one trace sample range. */
  place: (t: GridTrace, from: number, to: number, stride: number) => Xy[];
}): FollowModel {
  const {refTrace, traces, shown, cursorM, place} = input;
  const visibleM = followVisibleM(input.windowSpanM);
  const fromM = cursorM - visibleM * FOLLOW_BEHIND - MARGIN_M;
  const toM = cursorM + visibleM * FOLLOW_AHEAD + MARGIN_M;
  const pointAt = (t: GridTrace, m: number) => {
    const i = gridIndex(t, m);
    return place(t, i, i, 1)[0];
  };
  const range = (t: GridTrace) =>
    place(t, gridIndex(t, fromM), gridIndex(t, toM), 1);

  const centre = pointAt(refTrace, cursorM);
  const lines = shown
    .filter(r => traces.has(r.lapId))
    .map(r => ({...r, points: range(traces.get(r.lapId)!)}));

  const brakeTicks = shown
    .filter(r => r.key && traces.has(r.lapId))
    .flatMap(r => {
      const t = traces.get(r.lapId)!;
      return brakeOnsetsM(t.distanceM, t.brakePct, fromM, toM).map(m => {
        const at = pointAt(t, m);
        const h = headingRad(
          pointAt(t, m - HEADING_HALF_M),
          pointAt(t, m + HEADING_HALF_M),
        );
        // Perpendicular to the lap's heading.
        const nx = -Math.sin(h) * TICK_HALF_M;
        const ny = Math.cos(h) * TICK_HALF_M;
        return {
          ...r,
          ends: [
            {x: at.x + nx, y: at.y + ny},
            {x: at.x - nx, y: at.y - ny},
          ] as [Xy, Xy],
        };
      });
    });

  return {
    centre,
    headingRad: headingRad(
      pointAt(refTrace, cursorM - HEADING_HALF_M),
      pointAt(refTrace, cursorM + HEADING_HALF_M),
    ),
    visibleM,
    band: input.outline.length > 0 ? input.outline : [range(refTrace)],
    lines,
    brakeTicks,
    inset: {
      line: place(refTrace, 0, refTrace.lat.length - 1, INSET_STRIDE),
      at: centre,
    },
  };
}
