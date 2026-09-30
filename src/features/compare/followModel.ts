import {
  brakeOnsetsM,
  followVisibleM,
  headingRad,
} from '@/src/analysis/followView';
import {type GridTrace, gridIndex} from '@/src/analysis/resample';

import {type MapPlacer, type Xy} from '@/src/data/sessions';

// The Follow map's data (handoff v2 M1b), in two parts so playback stays
// cheap: geometry that only changes with the selection (built once, drawn
// in world metres), and the view that moves with the cursor.

export type FollowGeometry = {
  /** Road centrelines: the OSM outline, or the first lap's driven line. */
  band: Xy[][];
  /** Each lap's whole line at full grid resolution, by lap id. */
  lines: Map<string, Xy[]>;
  /** Short cross-track ticks where each lap's brake goes on, by lap id. */
  brakeTicks: Map<string, [Xy, Xy][]>;
  /** The first lap's whole line, thinned, for the inset. */
  inset: Xy[];
  /** Corner numbers, 10.5 m inside each apex (the prototype's offset). */
  corners: {n: number; official?: string; at: Xy}[];
};

export type FollowView = {centre: Xy; headingRad: number; visibleM: number};

// Heading from ±15 m around a point (the prototype's ±3 samples on 5 m).
const HEADING_HALF_M = 15;
// Brake ticks are 4.8 m across the lap's line, from the prototype.
const TICK_HALF_M = 2.4;
const INSET_STRIDE = 4;
const CORNER_INSIDE_M = 10.5;

function pointAt(placer: MapPlacer, t: GridTrace, m: number): Xy {
  const i = gridIndex(t, m);
  return placer.place(t, i, i, 1)[0];
}

function headingAt(placer: MapPlacer, t: GridTrace, m: number): number {
  return headingRad(
    pointAt(placer, t, m - HEADING_HALF_M),
    pointAt(placer, t, m + HEADING_HALF_M),
  );
}

/** Built once per selection. `lapIds[0]` is the reference. */
export function buildFollowGeometry(
  placer: MapPlacer,
  traces: Map<string, GridTrace>,
  lapIds: string[],
  corners: {n: number; official?: string; apexM: number}[],
): FollowGeometry | null {
  const ref = traces.get(lapIds[0]);
  if (!ref) return null;
  const whole = (t: GridTrace, stride: number) =>
    placer.place(t, 0, t.lat.length - 1, stride);
  const lines = new Map<string, Xy[]>();
  const brakeTicks = new Map<string, [Xy, Xy][]>();
  for (const id of lapIds) {
    const t = traces.get(id);
    if (!t) continue;
    lines.set(id, whole(t, 1));
    brakeTicks.set(
      id,
      brakeOnsetsM(t.distanceM, t.brakePct).map(m => {
        const at = pointAt(placer, t, m);
        const h = headingAt(placer, t, m);
        // Perpendicular to the lap's heading.
        const nx = -Math.sin(h) * TICK_HALF_M;
        const ny = Math.cos(h) * TICK_HALF_M;
        return [
          {x: at.x + nx, y: at.y + ny},
          {x: at.x - nx, y: at.y - ny},
        ];
      }),
    );
  }
  return {
    band: placer.outline.length > 0 ? placer.outline : [whole(ref, 1)],
    lines,
    brakeTicks,
    inset: whole(ref, INSET_STRIDE),
    corners: corners.map(c => {
      const prev = pointAt(placer, ref, c.apexM - HEADING_HALF_M);
      const at = pointAt(placer, ref, c.apexM);
      const next = pointAt(placer, ref, c.apexM + HEADING_HALF_M);
      // The left normal, flipped to the side the line turns towards.
      const h = headingRad(prev, next);
      const turn =
        (at.x - prev.x) * (next.y - at.y) - (at.y - prev.y) * (next.x - at.x);
      const side = turn >= 0 ? 1 : -1;
      return {
        n: c.n,
        official: c.official,
        at: {
          x: at.x - Math.sin(h) * CORNER_INSIDE_M * side,
          y: at.y + Math.cos(h) * CORNER_INSIDE_M * side,
        },
      };
    }),
  };
}

/** Per cursor: where the car is, which way it points, how far to show. */
export function buildFollowView(
  placer: MapPlacer,
  refTrace: GridTrace,
  cursorM: number,
  /** Chart window span in metres; null for the whole lap. */
  windowSpanM: number | null,
): FollowView {
  return {
    centre: pointAt(placer, refTrace, cursorM),
    headingRad: headingAt(placer, refTrace, cursorM),
    visibleM: followVisibleM(windowSpanM),
  };
}
