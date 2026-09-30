import {memo, useMemo} from 'react';
import {Path} from 'react-native-svg';

import {type FollowXy} from '@/src/analysis/followView';

// The measured road in the Follow map's world space (metres east/north): the
// game's own asphalt edges (src/analysis/trackSurface.ts), so it is as wide
// as the asphalt is, not a fixed 12 m. Filled between the edges; each edge is
// a solid line where it was measured, and a dashed line where it was not,
// placed at the track's median half-width (the legend says so). A bin with
// neither edge measured and no median width falls back to ROAD_M across.

export type MeasuredRunView = {
  centre: FollowXy[];
  left: (FollowXy | null)[];
  right: (FollowXy | null)[];
  leftDashed: (FollowXy | null)[];
  rightDashed: (FollowXy | null)[];
  closed: boolean;
};

const ROAD_M = 12;
const EDGE_W = 1.3;
const DASH = '5 4';

const at = (p: FollowXy) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;

/** The point on one side of a bin: measured, else dashed, else half of ROAD_M across. */
function side(
  run: MeasuredRunView,
  i: number,
  measured: (FollowXy | null)[],
  dashed: (FollowXy | null)[],
  sign: 1 | -1,
): FollowXy {
  const m = measured[i] ?? dashed[i];
  if (m) return m;
  const c = run.centre[i];
  const a = run.centre[Math.max(0, i - 1)];
  const b = run.centre[Math.min(run.centre.length - 1, i + 1)];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  // Left of travel is (-dy, dx); the right side is its opposite.
  return {
    x: c.x + (sign * -(b.y - a.y) * (ROAD_M / 2)) / len,
    y: c.y + (sign * (b.x - a.x) * (ROAD_M / 2)) / len,
  };
}

/** Runs of consecutive points as an SVG path; a gap (null) starts a new run. */
function polylines(points: (FollowXy | null)[]): string {
  let d = '';
  let open = false;
  for (const p of points) {
    if (!p) {
      open = false;
      continue;
    }
    d += `${open ? 'L' : 'M'}${at(p)}`;
    open = true;
  }
  return d;
}

export const MeasuredRoad = memo(function MeasuredRoad({
  runs,
  fill,
  edge,
}: {
  runs: MeasuredRunView[];
  fill: string;
  edge: string;
}) {
  const paths = useMemo(
    () =>
      runs.map(run => {
        const idx = run.centre.map((_, i) => i);
        const left = idx.map(i => side(run, i, run.left, run.leftDashed, -1));
        const right = idx.map(i => side(run, i, run.right, run.rightDashed, 1));
        const ring = (pts: FollowXy[]) =>
          `M${pts.map(at).join('L')}${run.closed ? 'Z' : ''}`;
        // A loop is the band between two rings (even-odd); an open road is
        // one polygon, out along the left edge and back along the right.
        const area = run.closed
          ? `${ring(left)}${ring(right)}`
          : `M${[...left, ...[...right].reverse()].map(at).join('L')}Z`;
        const close = (pts: (FollowXy | null)[]) =>
          run.closed && pts[0] ? [...pts, pts[0]] : pts;
        return {
          area,
          solid: polylines(close(run.left)) + polylines(close(run.right)),
          dashed:
            polylines(close(run.leftDashed)) +
            polylines(close(run.rightDashed)),
        };
      }),
    [runs],
  );
  return (
    <>
      {paths.map((p, i) => (
        <Path key={`a${i}`} d={p.area} fill={fill} fillRule='evenodd' />
      ))}
      {paths.map((p, i) => (
        <Path
          key={`s${i}`}
          d={p.solid}
          stroke={edge}
          strokeWidth={EDGE_W}
          vectorEffect='non-scaling-stroke'
          strokeLinejoin='round'
          fill='none'
        />
      ))}
      {paths.map((p, i) => (
        <Path
          key={`d${i}`}
          d={p.dashed}
          stroke={edge}
          strokeOpacity={0.6}
          strokeWidth={EDGE_W}
          strokeDasharray={DASH}
          vectorEffect='non-scaling-stroke'
          fill='none'
        />
      ))}
    </>
  );
});
