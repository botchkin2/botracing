import {memo, useMemo} from 'react';
import {StyleSheet, View} from 'react-native';
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from 'react-native-svg';

import {
  type FollowXy,
  followMatrix,
  followProject,
  followScale,
} from '@/src/analysis/followView';
import {type as typeScale, useTheme} from '@/src/design';

// Follow map (handoff v2 M1b): heading-up chase view around the cursor.
// The road, each lap's line and the brake ticks are world-space paths built
// once and moved by one transform per frame; the dots, the 20 m scale bar
// and the whole-lap inset are drawn in screen space. Inputs are metres
// east/north.

export type FollowLine = {
  key: string;
  points: FollowXy[];
  color: string;
  width: number;
  opacity: number;
};

export type FollowTicks = {
  key: string;
  ticks: [FollowXy, FollowXy][];
  color: string;
};

export type FollowDot = {key: string; at: FollowXy; color: string};

// Road is 12 m wide, edges 1.3 pt, ticks 2.2 pt, from the v2 frame.
const ROAD_M = 12;
const EDGE_W = 1.3;
const TICK_W = 2.2;
const DOT_R = 5;
const SCALE_M = 20;
const SCALE_X = 12;
const INSET_W = 96;
const INSET_H = 64;
const INSET_PAD = 6;
const INSET_GAP = 8;

function pathOf(
  pts: FollowXy[],
  f: (p: FollowXy) => FollowXy = p => p,
): string {
  let d = '';
  for (let i = 0; i < pts.length; i++) {
    const q = f(pts[i]);
    d += `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  }
  return d;
}

export function FollowMap({
  width,
  height,
  centre,
  headingRad,
  visibleM,
  band,
  lines,
  ticks,
  dots,
  inset,
}: {
  width: number;
  height: number;
  centre: FollowXy;
  headingRad: number;
  visibleM: number;
  /** Road centrelines (OSM outline, or the reference's driven line). */
  band: FollowXy[][];
  /** Drawn in order; put key laps last so they sit on top. Keep stable. */
  lines: FollowLine[];
  /** Keep stable, like lines. */
  ticks: FollowTicks[];
  dots: FollowDot[];
  /** Whole reference lap, for the inset. */
  inset: FollowXy[];
}) {
  const {color} = useTheme();
  const view = {centre, headingRad, visibleM, width, height};
  const sc = followScale(view);
  const project = followProject(view);
  const axis = typeScale.axis;
  const scaleY = height - 10;

  return (
    <View style={{width, height}}>
      <Svg width={width} height={height}>
        <G transform={`matrix(${followMatrix(view).join(' ')})`}>
          <World
            band={band}
            lines={lines}
            ticks={ticks}
            edgeM={EDGE_W / sc}
            edge={color.followEdge}
            fill={color.trackFill}
          />
        </G>
        {dots.map(d => {
          const q = project(d.at);
          return (
            <Circle
              key={d.key}
              cx={q.x}
              cy={q.y}
              r={DOT_R}
              fill={d.color}
              stroke={color.bg}
              strokeWidth={1.5}
            />
          );
        })}
        <Line
          x1={SCALE_X}
          x2={SCALE_X + SCALE_M * sc}
          y1={scaleY}
          y2={scaleY}
          stroke={color.textMuted}
          strokeWidth={1.5}
        />
        <SvgText
          x={SCALE_X + SCALE_M * sc + 6}
          y={scaleY + 3}
          fill={color.textMuted}
          fontFamily={axis.fontFamily}
          fontSize={9}>
          {`${SCALE_M} m`}
        </SvgText>
      </Svg>
      <Inset line={inset} at={centre} />
    </View>
  );
}

// World-space layers, memoized: the path strings rebuild only when the
// selection or zoom changes, not when the view moves. The road is 12 m wide,
// so it scales with the view; lines and ticks keep their point widths.
const World = memo(function World({
  band,
  lines,
  ticks,
  edgeM,
  edge,
  fill,
}: {
  band: FollowXy[][];
  lines: FollowLine[];
  ticks: FollowTicks[];
  /** Edge width in metres at the current zoom. */
  edgeM: number;
  edge: string;
  fill: string;
}) {
  const bandPaths = useMemo(() => band.map(b => pathOf(b)), [band]);
  const linePaths = useMemo(
    () => lines.map(l => ({...l, d: pathOf(l.points)})),
    [lines],
  );
  return (
    <>
      {/* Edge colour under a slightly narrower fill: a road with edges. */}
      {bandPaths.map((d, i) => (
        <Path
          key={`e${i}`}
          d={d}
          stroke={edge}
          strokeWidth={ROAD_M + 2 * edgeM}
          strokeLinejoin='round'
          strokeLinecap='round'
          fill='none'
        />
      ))}
      {bandPaths.map((d, i) => (
        <Path
          key={`f${i}`}
          d={d}
          stroke={fill}
          strokeWidth={ROAD_M}
          strokeLinejoin='round'
          strokeLinecap='round'
          fill='none'
        />
      ))}
      {linePaths.map(l => (
        <Path
          key={l.key}
          d={l.d}
          stroke={l.color}
          strokeWidth={l.width}
          strokeOpacity={l.opacity}
          strokeLinejoin='round'
          vectorEffect='non-scaling-stroke'
          fill='none'
        />
      ))}
      {ticks.flatMap(t =>
        t.ticks.map(([a, b], i) => (
          <Line
            key={`${t.key}-${i}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={t.color}
            strokeWidth={TICK_W}
            vectorEffect='non-scaling-stroke'
          />
        )),
      )}
    </>
  );
});

function Inset({line, at}: {line: FollowXy[]; at: FollowXy}) {
  const {color} = useTheme();
  const fit = useMemo(() => {
    if (line.length === 0) return null;
    const xs = line.map(p => p.x);
    const ys = line.map(p => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const spanX = Math.max(...xs) - minX || 1;
    const spanY = Math.max(...ys) - minY || 1;
    const s = Math.min(
      (INSET_W - 2 * INSET_PAD) / spanX,
      (INSET_H - 2 * INSET_PAD) / spanY,
    );
    const ox = (INSET_W - spanX * s) / 2;
    const oy = (INSET_H - spanY * s) / 2;
    const to = (p: FollowXy) => ({
      x: ox + (p.x - minX) * s,
      y: INSET_H - (oy + (p.y - minY) * s),
    });
    return {to, d: pathOf(line, to)};
  }, [line]);
  if (!fit) return null;
  const q = fit.to(at);
  return (
    <View style={styles.inset}>
      <Svg width={INSET_W} height={INSET_H}>
        <Rect
          x={0.5}
          y={0.5}
          width={INSET_W - 1}
          height={INSET_H - 1}
          rx={3}
          fill={color.bg}
          fillOpacity={0.85}
          stroke={color.lineStrong}
        />
        <Path
          d={fit.d}
          stroke={color.followEdge}
          strokeWidth={1.5}
          fill='none'
        />
        <Circle cx={q.x} cy={q.y} r={3} fill={color.accent} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  inset: {
    position: 'absolute',
    right: INSET_GAP,
    top: INSET_GAP,
    width: INSET_W,
    height: INSET_H,
  },
});
