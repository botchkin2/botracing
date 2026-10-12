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

import {type Box} from '@/src/analysis/carLabels';
import {
  type FollowXy,
  followMatrix,
  followProject,
  followScale,
} from '@/src/analysis/followView';
import {fonts, type as typeScale, useTheme, turnLabel} from '@/src/design';

import {MeasuredRoad, type MeasuredRunView} from './MeasuredRoad';

import {CarDots, type MapCar} from './CarDots';
import {Pressable} from '@/src/ui';

// Follow map (handoff v2 M1b): heading-up chase view around the cursor.
// The road, each lap's line and the brake ticks are world-space paths built
// once, on a static Svg of their own (1 unit = 1 m), and a frame moves that
// layer with one View transform, so no path is re-recorded for it; the dots,
// the 20 m scale bar and the whole-lap inset are drawn in screen space.
// Inputs are metres east/north.

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
/** Where the whole-lap inset ends: the radar sits right under it (round 7, 2C). */
export const FOLLOW_INSET_BOTTOM = INSET_GAP + INSET_H;
// A finger's reach around a car, for pressing it.
const CAR_HIT = 44;
// Cars this far outside the frame are not drawn: the field is 60 cars.
const CAR_MARGIN = 24;
const NO_CARS: MapCar[] = [];

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

/** Where the world layer sits: its box in metres, padded past the road's edge. */
function worldBox(
  groups: FollowXy[][],
  surface: MeasuredRunView[] | undefined,
): {minX: number; maxY: number; w: number; h: number} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const eat = (p: FollowXy | null) => {
    if (!p) return;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  };
  for (const g of groups) for (const p of g) eat(p);
  for (const r of surface ?? []) {
    for (const p of r.centre) eat(p);
    for (const side of [r.left, r.right, r.leftDashed, r.rightDashed])
      for (const p of side) eat(p);
  }
  if (minX > maxX) return {minX: 0, maxY: 0, w: 1, h: 1};
  const pad = ROAD_M * 2;
  return {
    minX: minX - pad,
    maxY: maxY + pad,
    w: maxX - minX + 2 * pad,
    h: maxY - minY + 2 * pad,
  };
}

export function FollowMap({
  width,
  height,
  centre,
  headingRad,
  visibleM,
  band,
  bandFaded,
  surface,
  lines,
  ticks,
  dots,
  inset,
  corners,
  cars = NO_CARS,
  avoidLabels,
  onPressCar,
  scaleX = SCALE_X,
}: {
  width: number;
  height: number;
  centre: FollowXy;
  headingRad: number;
  visibleM: number;
  /** Road centrelines (OSM outline, or the reference's driven line). */
  band: FollowXy[][];
  /** Outline stretches the lap does not use; drawn under the band, quietly. */
  bandFaded?: FollowXy[][];
  /** The measured road (the game's own edges), drawn over the band. */
  surface?: MeasuredRunView[];
  /** Drawn in order; put key laps last so they sit on top. Keep stable. */
  lines: FollowLine[];
  /** Keep stable, like lines. */
  ticks: FollowTicks[];
  dots: FollowDot[];
  /** Whole reference lap, for the inset. */
  inset: FollowXy[];
  /** Corner numbers, placed inside each apex (world metres). */
  corners: {n: number; official?: string; at: FollowXy}[];
  /** Every car of a race, `at` in world metres like the rest; projected here. */
  cars?: MapCar[];
  /** Screen boxes the car labels keep off (controls, the radar inset). */
  avoidLabels?: Box[];
  /** The nearest car within a finger's reach of a press. */
  onPressCar?: (key: string) => void;
  /** Left edge of the scale bar, to clear controls in the corner. */
  scaleX?: number;
}) {
  const {color} = useTheme();
  const view = {centre, headingRad, visibleM, width, height};
  const sc = followScale(view);
  const project = followProject(view);
  const axis = typeScale.axis;
  // One row up from the bottom edge, clear of the attribution.
  const scaleY = height - 24;
  const screenCars = useMemo(() => {
    const p = followProject({centre, headingRad, visibleM, width, height});
    const shown: MapCar[] = [];
    for (const c of cars) {
      const at = p(c.at);
      if (
        at.x >= -CAR_MARGIN &&
        at.x <= width + CAR_MARGIN &&
        at.y >= -CAR_MARGIN &&
        at.y <= height + CAR_MARGIN
      )
        shown.push({...c, at});
    }
    return shown;
  }, [cars, centre, headingRad, visibleM, width, height]);
  const bounds = useMemo(() => ({width, height}), [width, height]);
  const box = useMemo(
    () =>
      worldBox(
        [...band, ...(bandFaded ?? []), ...lines.map(l => l.points)],
        surface,
      ),
    [band, bandFaded, lines, surface],
  );
  // The layer's local (u, v) is (x - minX, maxY - y) in metres; this maps it to the screen.
  const [ma, mb, mc, md, me, mf] = followMatrix(view);
  const layerMatrix = [
    ma,
    mb,
    0,
    0,
    -mc,
    -md,
    0,
    0,
    0,
    0,
    1,
    0,
    ma * box.minX + mc * box.maxY + me,
    mb * box.minX + md * box.maxY + mf,
    0,
    1,
  ];

  return (
    <View style={{width, height}}>
      {/* The world: drawn once at 1 unit per metre, moved by the matrix. */}
      <View pointerEvents='none' style={[StyleSheet.absoluteFill, styles.clip]}>
        <View
          style={[
            styles.layer,
            {width: box.w, height: box.h, transform: [{matrix: layerMatrix}]},
          ]}>
          <Svg width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`}>
            <G transform={`matrix(1 0 0 -1 ${-box.minX} ${box.maxY})`}>
              <World
                band={band}
                bandFaded={bandFaded}
                surface={surface}
                lines={lines}
                ticks={ticks}
                pt={1 / sc}
                edge={color.followEdge}
                fill={color.trackFill}
                faded={color.outlineFaded}
              />
            </G>
          </Svg>
        </View>
      </View>
      <Svg width={width} height={height}>
        {corners.map(c => {
          const q = project(c.at);
          if (q.x < 8 || q.x > width - 8 || q.y < 8 || q.y > height - 8)
            return null;
          return (
            <SvgText
              key={`c${c.n}`}
              x={q.x}
              y={q.y + 3}
              textAnchor='middle'
              fill={color.mapCornerLabel}
              fontFamily={fonts.monoMedium}
              fontSize={8.5}>
              {turnLabel(c.n, c.official)}
            </SvgText>
          );
        })}
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
        {screenCars.length > 0 && (
          <CarDots cars={screenCars} avoid={avoidLabels} bounds={bounds} />
        )}
        <Line
          x1={scaleX}
          x2={scaleX + SCALE_M * sc}
          y1={scaleY}
          y2={scaleY}
          stroke={color.textMuted}
          strokeWidth={1.5}
        />
        <SvgText
          x={scaleX + SCALE_M * sc + 6}
          y={scaleY + 3}
          fill={color.textMuted}
          fontFamily={axis.fontFamily}
          fontSize={9}>
          {`${SCALE_M} m`}
        </SvgText>
      </Svg>
      <Inset line={inset} at={centre} />
      {/* One press target, like TrackMap: the cars move every frame. */}
      {onPressCar && screenCars.length > 0 && (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Cars on the map'
          onPress={e => {
            const {locationX: x, locationY: y} = e.nativeEvent;
            let best: string | null = null;
            let bestD = CAR_HIT / 2;
            for (const c of screenCars) {
              const d = Math.hypot(c.at.x - x, c.at.y - y);
              if (d < bestD) {
                bestD = d;
                best = c.key;
              }
            }
            if (best !== null) onPressCar(best);
          }}
          style={StyleSheet.absoluteFill}
        />
      )}
    </View>
  );
}

// World-space layers, memoized: the path strings rebuild only when the
// selection or zoom changes, not when the view moves. The road is 12 m wide,
// so it scales with the view; lines and ticks keep their point widths.
const World = memo(function World({
  band,
  bandFaded,
  surface,
  lines,
  ticks,
  pt,
  edge,
  fill,
  faded,
}: {
  band: FollowXy[][];
  bandFaded?: FollowXy[][];
  surface?: MeasuredRunView[];
  lines: FollowLine[];
  ticks: FollowTicks[];
  /** Metres per screen point at the current zoom: widths are set in metres. */
  pt: number;
  edge: string;
  fill: string;
  faded: string;
}) {
  const bandPaths = useMemo(() => band.map(b => pathOf(b)), [band]);
  const fadedPaths = useMemo(
    () => (bandFaded ?? []).map(b => pathOf(b)),
    [bandFaded],
  );
  const linePaths = useMemo(
    () => lines.map(l => ({...l, d: pathOf(l.points)})),
    [lines],
  );
  return (
    <>
      {fadedPaths.map((d, i) => (
        <Path
          key={`x${i}`}
          d={d}
          stroke={faded}
          strokeWidth={ROAD_M}
          strokeLinejoin='round'
          strokeLinecap='round'
          fill='none'
        />
      ))}
      {/* Edge colour under a slightly narrower fill: a road with edges. */}
      {bandPaths.map((d, i) => (
        <Path
          key={`e${i}`}
          d={d}
          stroke={edge}
          strokeWidth={ROAD_M + 2 * EDGE_W * pt}
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
      {surface && surface.length > 0 ? (
        <MeasuredRoad runs={surface} fill={fill} edge={edge} pt={pt} />
      ) : null}
      {linePaths.map(l => (
        <Path
          key={l.key}
          d={l.d}
          stroke={l.color}
          strokeWidth={l.width * pt}
          strokeOpacity={l.opacity}
          strokeLinejoin='round'
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
            strokeWidth={TICK_W * pt}
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
  clip: {overflow: 'hidden'},
  layer: {position: 'absolute', left: 0, top: 0, transformOrigin: '0px 0px'},
  inset: {
    position: 'absolute',
    right: INSET_GAP,
    top: INSET_GAP,
    width: INSET_W,
    height: INSET_H,
  },
});
