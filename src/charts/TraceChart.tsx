import {type NativeSamples} from '@/src/analysis/nativeSamples';

import {
  areaPath,
  type ChunkFrame,
  chunkPath,
  chunksIn,
  objectId,
} from './chunkPaths';
import {firstExit} from './firstExit';
import {useTweenedRanges} from './useTweenedRanges';
import {useEffect, useMemo, useRef, useState} from 'react';
import {PanResponder, StyleSheet, View, type ViewStyle} from 'react-native';
import Svg, {
  ClipPath,
  Defs,
  G,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from 'react-native-svg';

import {
  distanceAtTime,
  gridStepM,
  timeAtDistance,
  timeAtIndex,
  timeGridStepM,
  type TimedGrid,
} from '@/src/analysis/window';
import {dash, stroke, type as typeScale, useTheme} from '@/src/design';

// Channels against distance on a shared grid (handoff §3 charts). Pure props:
// the caller picks colors, widths and dashes.
//
// x is metres across windowM, or with timeAxis, the reference lap's elapsed
// time across windowS (time mode: a constant scale while playing). Marks,
// gridlines and the cursor go through the same mapping.
//
// Two ways to move: in a window, dragging pans (onPan gets the drag in points
// and the cursor stays fixed); on the whole lap, dragging scrubs (onScrub
// gets the distance under the finger).

export type TraceSeries = {
  key: string;
  /** One value per grid point (index * stepM metres from the line). */
  values: number[];
  color: string;
  width: number;
  opacity: number;
  dash?: string;
  /** Fill under the line down to 0, at this opacity (brake). */
  fill?: number;
  /** Own y range; series without one share the chart's. */
  domain?: [number, number];
  /** Y tick labels at this series' own range (a stacked chart's steering band). */
  ticks?: {v: number; label: string}[];
  /** Discrete channel (gear): drawn as steps, never smoothed. */
  stepped?: boolean;
  /** Recorded samples: drawn instead of `values` when given. */
  samples?: NativeSamples;
  /** Neighbour laps before the line and after the end, drawn dimmed. */
  before?: NativeSamples;
  after?: NativeSamples;
};

export type TraceBand = {low: number[]; high: number[]};

const Y_PAD = 3;
// Neighbour laps across the line are context, not the selected lap.
const WRAP_OPACITY = 0.4;
// How much the background covers what is outside a shaded stretch.
const DIM_OPACITY = 0.6;
const AXIS_H = 12;
// A base band (a span along the bottom edge) is this thick, in points.
const BASE_BAND_H = 4;
// Labels closer than this to the right edge are dropped (handoff).
const LABEL_EDGE_PT = 34;

// Plot y of a value is a + b·v for a y range: its offset and scale.
function markAt(x: number, edgeY: number, dir: 1 | -1): string {
  const tip = edgeY + dir * 5;
  return `M${(x - 3).toFixed(1)},${edgeY}L${(x + 3).toFixed(
    1,
  )},${edgeY}L${x.toFixed(1)},${tip}Z`;
}

function yLine([lo, hi]: [number, number], height: number): [number, number] {
  const b = -(height - 2 * Y_PAD) / (hi - lo || 1);
  return [Y_PAD - b * hi, b];
}

let clipSeq = 0;

export function TraceChart({
  width,
  height,
  stepM,
  windowM,
  domain,
  series,
  band,
  zeroLine,
  yTicks,
  sideLabels,
  zeroDomain,
  cursorM,
  marks = [],
  gridOriginM,
  stretchM,
  baseBand,
  dimM,
  onScrub,
  onPan,
  onPanStart,
  onHover,
  hoverM,
  frameM,
  timeAxis,
}: {
  width: number;
  /** Plot height; the distance axis adds AXIS_H under it. */
  height: number;
  stepM: number;
  /** Visible distance range [start, end] in metres. */
  windowM: [number, number];
  domain: [number, number];
  series: TraceSeries[];
  band?: TraceBand;
  zeroLine?: boolean;
  /** Labelled values on the left edge (the gear chart's gear numbers). */
  yTicks?: {v: number; label: string}[];
  /** Words beside the zero line: above it, and below (lateral: L and R). */
  sideLabels?: {above: string; below: string};
  /** The y range the zero line belongs to, when it is not the chart's own
   *  (an overlay: steering's 0, not 0 km/h). */
  zeroDomain?: [number, number];
  cursorM: number;
  /** Vertical marks: labelled (apex lines), or colored per lap (brake points). */
  marks?: {m: number; label?: string; color?: string; solid?: boolean}[];
  /**
   * Grid relative to this distance (e.g. the apex): ticks at origin ± k·step,
   * labelled "−200 m", "+100 m"; the origin itself carries no tick label.
   */
  gridOriginM?: number;
  /** A stretch of the window to tint (Corner: this turn's own stretch). */
  stretchM?: [number, number];
  /** A thin band along the bottom edge over a distance range, in its own colour (the brake zone). */
  baseBand?: {fromM: number; toM: number; color: string};
  /** Ranges of the window to dim over the traces (outside that stretch). */
  dimM?: [number, number][];
  onScrub?: (distanceM: number) => void;
  /** Drag in points since the last call; when set, dragging pans. */
  onPan?: (dxPt: number) => void;
  onPanStart?: () => void;
  /** Pointer position (web/desktop), or null when it leaves. Never required. */
  onHover?: (distanceM: number | null) => void;
  /** Dashed hover line, when a pointer is over any chart. */
  hoverM?: number | null;
  /** Accent frame over a distance range (the overview's detail window). */
  frameM?: [number, number];
  /** Time mode: x is the reference's elapsed time across windowS. */
  timeAxis?: {ref: TimedGrid; windowS: [number, number]} | null;
}) {
  const {color} = useTheme();
  const [startM, endM] = windowM;
  const spanM = endM - startM || 1;
  const from = Math.max(0, Math.floor(startM / stepM) - 1);
  const to = Math.ceil(endM / stepM) + 1;
  const tRef = timeAxis?.ref;
  const [t0, t1] = timeAxis?.windowS ?? [0, 1];
  const spanS = t1 - t0 || 1;
  // Grid index, metres and pointer x through the one mapping.
  const x = tRef
    ? (i: number) => ((timeAtIndex(tRef, i) - t0) / spanS) * width
    : (i: number) => ((i * stepM - startM) / spanM) * width;
  const xOfM = tRef
    ? (m: number) => ((timeAtDistance(tRef, m) - t0) / spanS) * width
    : (m: number) => ((m - startM) / spanM) * width;
  const xClamp = (m: number) => Math.min(width, Math.max(0, xOfM(m)));
  const mOfX = (px: number) =>
    tRef
      ? distanceAtTime(tRef, t0 + (px / width) * spanS)
      : startM + (px / width) * spanM;
  // A label at the top of its range sits under the rule, one at the bottom sits
  // above it: never on the edge, where the chart's clip would cut it off.
  const tickBaseline = (d: [number, number], v: number) => {
    const at = yFor(d)(v);
    if (v >= d[1]) return at + 10;
    if (v <= d[0]) return at - 4;
    return at + 3;
  };
  const yFor =
    ([lo, hi]: [number, number]) =>
    (v: number) =>
      Y_PAD + (1 - (v - lo) / (hi - lo || 1)) * (height - 2 * Y_PAD);
  // Ranges ease into a new scale (150 ms) instead of jumping.
  const [domainT, zeroDomainT, ...seriesDomainsT] = useTweenedRanges([
    domain,
    zeroDomain ?? domain,
    ...series.map(s => s.domain ?? domain),
  ]);
  const y = yFor(domainT);
  const yZero = yFor(zeroDomainT)(0);
  // One clip per chart, so a series drawn past the scale stops at the plot edge.
  const [clipId] = useState(() => `trace-clip-${++clipSeq}`);
  // A marker where a series first leaves the scale: a small triangle on the edge
  // it left by. Recorded-sample series (no values) are clipped but not marked.
  const clipMarks = series.flatMap(s => {
    if (s.samples) return [];
    const [lo, hi] = s.domain ?? domain;
    const exit = firstExit(s.values, from, to, lo, hi);
    if (!exit) return [];
    const edgeY = exit.edge === 'top' ? 0 : height;
    return [
      {
        key: `${s.key}-${exit.edge}`,
        color: s.color,
        d: markAt(x(exit.index), edgeY, exit.edge === 'top' ? 1 : -1),
      },
    ];
  });
  // Smooth only when zoomed in enough that points are far apart.
  const pointsPerPt = (to - from) / width;

  // Lines are built once per chunk in lap-wide build pixels (chunkPaths.ts)
  // and placed with one transform per series: x scrolls with the window, and
  // y eases from the built range to the shown one during a tween.
  // Rounded: t1 − t0 carries float noise that differs frame to frame, and
  // the scale is part of the chunks' cache key.
  const uSpan = Math.round((tRef ? spanS : spanM) * 1e6) / 1e6;
  const sx = width / uSpan;
  const u0 = tRef ? t0 : startM;
  const lapM = Math.max(0, ...series.map(s => (s.values.length - 1) * stepM));
  const uOfM = (m: number) => (tRef ? timeAtDistance(tRef, m) : m);
  const mPerPx = lapM / ((uOfM(lapM) || 1) * sx) || stepM;
  const chunks = chunksIn(u0 * sx, u0 * sx + width, width);
  const paths = series.map((s, si) => {
    const built = s.domain ?? domain;
    const frame: ChunkFrame = {
      key: [
        tRef ? objectId(tRef) : 'm',
        sx,
        width,
        height,
        built[0],
        built[1],
        // Stride and thinning follow from these: a longer lap joining the
        // selection changes mPerPx (scrutineer, #80).
        mPerPx,
        stepM,
      ].join('|'),
      uOfM,
      uOfIndex: i => (tRef ? timeAtIndex(tRef, i) : i * stepM),
      stepM,
      sx,
      y: yFor(built),
      chunkPx: width,
      mPerPx,
    };
    // y: built range → shown (tweened) range, as scale and offset.
    const [ab, bb] = yLine(built, height);
    const [at, bt] = yLine(seriesDomainsT[si] ?? domainT, height);
    const ky = bt / bb;
    return {
      ...s,
      transform: `matrix(1 0 0 ${ky} ${-u0 * sx} ${at - ky * ab})`,
      ds: chunks
        .map(k => ({k, d: chunkPath(s, frame, k)}))
        .filter(c => c.d !== ''),
      base: frame.y(0),
      // The neighbour laps either side of the line (the S/F wrap), through
      // the same chunks and transform. Away from the line their chunks are
      // empty: drop them, or every frame reconciles hundreds of empty paths.
      wraps: [s.before, s.after].flatMap((ns, w) =>
        ns
          ? chunks
              .map(k => ({
                k: `w${w}-${k}`,
                d: chunkPath(
                  {values: [], samples: ns, stepped: s.stepped},
                  frame,
                  k,
                ),
              }))
              .filter(c => c.d !== '')
          : [],
      ),
    };
  });

  const bandPath = useMemo(() => {
    if (!band) return null;
    const last = Math.min(to, band.low.length - 1);
    const stride = Math.max(1, Math.floor(pointsPerPt));
    let d = '';
    for (let i = from; i <= last; i += stride)
      d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(band.high[i]).toFixed(1)}`;
    for (let i = last; i >= from; i -= stride)
      d += `L${x(i).toFixed(1)},${y(band.low[i]).toFixed(1)}`;
    return `${d}Z`;
  }, [band, from, to, width, height, startM, endM, domainT, tRef, t0, t1]);

  // Apex-relative grids use the handoff's fixed 100 m ticks.
  const step =
    gridOriginM != null
      ? 100
      : tRef
      ? timeGridStepM(tRef, spanS, width)
      : gridStepM(spanM, width);
  const gridMs: number[] = [];
  const origin = gridOriginM ?? 0;
  for (
    let m = origin + Math.ceil((startM - origin) / step) * step;
    m <= endM;
    m += step
  )
    if (m >= 0) gridMs.push(m);
  const tickLabel = (m: number) => {
    if (gridOriginM == null) return `${Math.round(m)}`;
    const d = Math.round(m - gridOriginM);
    return d === 0 ? '' : `${d > 0 ? '+' : '−'}${Math.abs(d)} m`;
  };

  // PanResponder reads its handlers once; keep the latest props in a ref.
  const latest = useRef({onScrub, onPan, onPanStart, mOfX});
  useEffect(() => {
    latest.current = {onScrub, onPan, onPanStart, mOfX};
  });
  const lastDx = useRef(0);
  // The ref is read only inside gesture callbacks, never during render; the
  // compiler cannot see that through PanResponder.create.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: e => {
        const p = latest.current;
        lastDx.current = 0;
        if (p.onPan) p.onPanStart?.();
        else p.onScrub?.(p.mOfX(e.nativeEvent.locationX));
      },
      onPanResponderMove: (e, g) => {
        const p = latest.current;
        if (p.onPan) {
          p.onPan(g.dx - lastDx.current);
          lastDx.current = g.dx;
        } else p.onScrub?.(p.mOfX(e.nativeEvent.locationX));
      },
    }),
  );

  const cx = xOfM(cursorM);
  const hx = hoverM == null ? null : xOfM(hoverM);
  // Pointer events exist on web; on native these props are ignored.
  const hoverProps = onHover
    ? {
        onPointerMove: (e: {
          nativeEvent: {offsetX?: number; locationX?: number};
        }) => {
          const px = e.nativeEvent.offsetX ?? e.nativeEvent.locationX ?? 0;
          onHover(mOfX(px));
        },
        onPointerLeave: () => onHover(null),
      }
    : {};
  const axis = typeScale.axis;
  return (
    <View
      {...responder.panHandlers}
      {...hoverProps}
      // Web: a mouse drag pans; without this it also selects the axis text.
      style={[styles.noSelect, {width, height: height + AXIS_H}]}>
      <Svg width={width} height={height + AXIS_H} pointerEvents='none'>
        {stretchM && (
          <Rect
            x={xClamp(stretchM[0])}
            y={0}
            width={Math.max(0, xClamp(stretchM[1]) - xClamp(stretchM[0]))}
            height={height}
            fill={color.accentTint}
          />
        )}
        {baseBand && (
          <Rect
            x={xClamp(baseBand.fromM)}
            y={height - BASE_BAND_H}
            width={Math.max(0, xClamp(baseBand.toM) - xClamp(baseBand.fromM))}
            height={BASE_BAND_H}
            fill={baseBand.color}
          />
        )}
        {gridMs.map(m => {
          const gx = xOfM(m);
          return (
            <G key={`g${m}`}>
              <Line
                x1={gx}
                x2={gx}
                y1={0}
                y2={height}
                stroke={color.grid}
                strokeWidth={1}
              />
              {gx < width - LABEL_EDGE_PT && (
                <SvgText
                  x={gx + 2}
                  y={height + AXIS_H - 2}
                  fill={color.textFaint}
                  fontFamily={axis.fontFamily}
                  fontSize={9}>
                  {tickLabel(m)}
                </SvgText>
              )}
            </G>
          );
        })}
        {marks.map((mk, i) => {
          const mx = xOfM(mk.m);
          return (
            <G key={`${mk.label ?? mk.color}-${i}`}>
              <Line
                x1={mx}
                x2={mx}
                y1={0}
                y2={height}
                stroke={mk.color ?? color.lineStrong}
                strokeWidth={1}
                strokeDasharray={mk.solid ? undefined : dash.mark}
              />
              {mk.label && mx < width - LABEL_EDGE_PT && (
                <SvgText
                  x={mx + 2}
                  y={9}
                  fill={color.textFaint}
                  fontFamily={axis.fontFamily}
                  fontSize={9}>
                  {mk.label}
                </SvgText>
              )}
            </G>
          );
        })}
        {bandPath && <Path d={bandPath} fill={color.band} />}
        {frameM && (
          <Rect
            x={xOfM(frameM[0])}
            y={0.5}
            width={Math.max(2, xOfM(frameM[1]) - xOfM(frameM[0]))}
            height={height - 1}
            fill={color.accentTint}
            stroke={color.accent}
            strokeWidth={1}
          />
        )}
        {zeroLine && (
          <Line
            x1={0}
            x2={width}
            y1={yZero}
            y2={yZero}
            stroke={color.median}
            strokeWidth={stroke.mark}
          />
        )}
        {yTicks?.map(t => (
          <SvgText
            key={`y${t.v}`}
            x={3}
            y={yFor(domainT)(t.v) + 3}
            fill={color.textFaint}
            fontFamily={axis.fontFamily}
            fontSize={9}>
            {t.label}
          </SvgText>
        ))}
        {series.map((s, si) =>
          s.ticks?.map(t => (
            <SvgText
              key={`s${si}y${t.v}`}
              x={3}
              y={tickBaseline(seriesDomainsT[si] ?? domainT, t.v)}
              fill={color.textFaint}
              fontFamily={axis.fontFamily}
              fontSize={9}>
              {t.label}
            </SvgText>
          )),
        )}
        {zeroLine && sideLabels && (
          <>
            <SvgText
              x={3}
              y={yZero - 3}
              fill={color.textFaint}
              fontFamily={axis.fontFamily}
              fontSize={9}>
              {sideLabels.above}
            </SvgText>
            <SvgText
              x={3}
              y={yZero + 10}
              fill={color.textFaint}
              fontFamily={axis.fontFamily}
              fontSize={9}>
              {sideLabels.below}
            </SvgText>
          </>
        )}
        <Defs>
          <ClipPath id={clipId}>
            <Rect x={0} y={0} width={width} height={height} />
          </ClipPath>
        </Defs>
        {/* Values beyond the scale are drawn clipped at the plot edge, never past it. */}
        <G clipPath={`url(#${clipId})`}>
          {paths.map(p => (
            <G key={p.key} transform={p.transform}>
              {p.wraps.map(c => (
                <Path
                  key={c.k}
                  d={c.d}
                  stroke={p.color}
                  strokeWidth={p.width}
                  strokeOpacity={p.opacity * WRAP_OPACITY}
                  strokeDasharray={p.dash}
                  strokeLinejoin='round'
                  vectorEffect='non-scaling-stroke'
                  fill='none'
                />
              ))}
              {p.ds.map(c =>
                p.fill == null ? null : (
                  <Path
                    key={`a${c.k}`}
                    d={areaPath(c.d, p.base)}
                    fill={p.color}
                    fillOpacity={p.fill * p.opacity}
                  />
                ),
              )}
              {p.ds.map(c => (
                <Path
                  key={c.k}
                  d={c.d}
                  stroke={p.color}
                  strokeWidth={p.width}
                  strokeOpacity={p.opacity}
                  strokeDasharray={p.dash}
                  strokeLinejoin='round'
                  vectorEffect='non-scaling-stroke'
                  fill='none'
                />
              ))}
            </G>
          ))}
        </G>
        {clipMarks.map(m => (
          <Path key={m.key} d={m.d} fill={m.color} />
        ))}
        {dimM?.map(([a, b]) => (
          <Rect
            key={`dim${a}`}
            x={xClamp(a)}
            y={0}
            width={Math.max(0, xClamp(b) - xClamp(a))}
            height={height}
            fill={color.bg}
            fillOpacity={DIM_OPACITY}
          />
        ))}
        {hx != null && hx >= 0 && hx <= width && (
          <Line
            x1={hx}
            x2={hx}
            y1={0}
            y2={height}
            stroke={color.text}
            strokeWidth={1}
            strokeDasharray={dash.mark}
          />
        )}
        {cx >= 0 && cx <= width && (
          <Line
            x1={cx}
            x2={cx}
            y1={0}
            y2={height}
            stroke={color.accent}
            strokeWidth={stroke.cursor}
          />
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  // RN types userSelect for Text only; react-native-web applies it to any
  // view, and CSS inherits it to the SVG axis labels inside.
  noSelect: {userSelect: 'none'} as ViewStyle,
});
