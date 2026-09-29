import {
  type NativeSamples,
  sliceSamples,
  thinSamples,
} from '@/src/analysis/nativeSamples';

import {useTweenedRanges} from './useTweenedRanges';
import {useEffect, useMemo, useRef, useState} from 'react';
import {PanResponder, StyleSheet, View, type ViewStyle} from 'react-native';
import Svg, {G, Line, Path, Rect, Text as SvgText} from 'react-native-svg';

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
  /** Own y range; series without one share the chart's. */
  domain?: [number, number];
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
const AXIS_H = 12;
// Labels closer than this to the right edge are dropped (handoff).
const LABEL_EDGE_PT = 34;

type Pt = [number, number];

// Catmull-Rom through the points, as cubic Béziers.
function smoothPath(pts: Pt[]): string {
  if (pts.length < 3)
    return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('');
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(
      1,
    )} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

// A curve through every point that never overshoots them (Fritsch–Carlson
// monotone cubic): a light smoothing of real samples that invents no peak
// or dip between them (Botkin, thread 26 #397; pitlane #402).
function monotonePath(pts: Pt[]): string {
  const n = pts.length;
  if (n < 3)
    return pts
      .map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
      .join('');
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0] || 1e-6);
    slope.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const t: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++)
    t.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  t.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / slope[i];
    const b = t[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const k = 3 / Math.sqrt(h);
      t[i] = k * a * slope[i];
      t[i + 1] = k * b * slope[i];
    }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = dx[i] / 3;
    d += `C${(x0 + h).toFixed(1)},${(y0 + t[i] * h).toFixed(1)} ${(
      x1 - h
    ).toFixed(1)},${(y1 - t[i + 1] * h).toFixed(1)} ${x1.toFixed(
      1,
    )},${y1.toFixed(1)}`;
  }
  return d;
}

function steppedPath(pts: Pt[]): string {
  let d = '';
  pts.forEach((p, i) => {
    if (i === 0) d = `M${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    else d += `H${p[0].toFixed(1)}V${p[1].toFixed(1)}`;
  });
  return d;
}

export function TraceChart({
  width,
  height,
  stepM,
  windowM,
  domain,
  series,
  band,
  zeroLine,
  zeroDomain,
  cursorM,
  marks = [],
  gridOriginM,
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
  const mOfX = (px: number) =>
    tRef
      ? distanceAtTime(tRef, t0 + (px / width) * spanS)
      : startM + (px / width) * spanM;
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
  // Smooth only when zoomed in enough that points are far apart.
  const pointsPerPt = (to - from) / width;

  const paths = useMemo(
    () =>
      series.map((s, si) => {
        const ys = yFor(seriesDomainsT[si] ?? domainT);
        // Recorded samples in the window; at whole-lap zoom, the extremes
        // per point, so every drawn vertex is still a real sample.
        const samplePath = (ns: NativeSamples) => {
          let w = sliceSamples(ns, startM, endM);
          if (w.distanceM.length > width * 2) w = thinSamples(w, spanM / width);
          const pts: Pt[] = w.distanceM.map((m, k) => [
            xOfM(m),
            ys(w.values[k]),
          ]);
          return s.stepped ? steppedPath(pts) : monotonePath(pts);
        };
        // The neighbour laps either side of the line (the S/F wrap).
        const wraps = [s.before, s.after]
          .filter((ns): ns is NativeSamples => ns != null)
          .map(samplePath);
        if (s.samples) return {...s, d: samplePath(s.samples), wraps};
        const last = Math.min(to, s.values.length - 1);
        const stride = Math.max(1, Math.floor(pointsPerPt));
        const pts: Pt[] = [];
        for (let i = from; i <= last; i += stride)
          pts.push([x(i), ys(s.values[i])]);
        const d = s.stepped
          ? steppedPath(pts)
          : pointsPerPt < 0.5
          ? smoothPath(pts)
          : pts
              .map(
                (p, i) =>
                  `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`,
              )
              .join('');
        return {...s, d, wraps};
      }),
    [
      series,
      from,
      to,
      width,
      height,
      startM,
      endM,
      domainT,
      seriesDomainsT,
      tRef,
      t0,
      t1,
    ],
  );

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
        {paths.flatMap(p =>
          p.wraps.map((d, i) => (
            <Path
              key={`${p.key}-wrap${i}`}
              d={d}
              stroke={p.color}
              strokeWidth={p.width}
              strokeOpacity={p.opacity * WRAP_OPACITY}
              strokeDasharray={p.dash}
              strokeLinejoin='round'
              fill='none'
            />
          )),
        )}
        {paths.map(p => (
          <Path
            key={p.key}
            d={p.d}
            stroke={p.color}
            strokeWidth={p.width}
            strokeOpacity={p.opacity}
            strokeDasharray={p.dash}
            strokeLinejoin='round'
            fill='none'
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
