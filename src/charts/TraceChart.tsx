import {useEffect, useMemo, useRef, useState} from 'react';
import {PanResponder, View} from 'react-native';
import Svg, {G, Line, Path, Rect, Text as SvgText} from 'react-native-svg';

import {gridStepM} from '@/src/analysis/window';
import {dash, stroke, type as typeScale, useTheme} from '@/src/design';

// Channels against distance on a shared grid (handoff §3 charts). Pure props:
// the caller picks colors, widths and dashes.
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
};

export type TraceBand = {low: number[]; high: number[]};

const Y_PAD = 3;
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
  cursorM,
  marks = [],
  gridOriginM,
  onScrub,
  onPan,
  onPanStart,
  onHover,
  hoverM,
  frameM,
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
}) {
  const {color} = useTheme();
  const [startM, endM] = windowM;
  const spanM = endM - startM || 1;
  const from = Math.max(0, Math.floor(startM / stepM) - 1);
  const to = Math.ceil(endM / stepM) + 1;
  const x = (i: number) => ((i * stepM - startM) / spanM) * width;
  const yFor =
    ([lo, hi]: [number, number]) =>
    (v: number) =>
      Y_PAD + (1 - (v - lo) / (hi - lo || 1)) * (height - 2 * Y_PAD);
  const y = yFor(domain);
  // Smooth only when zoomed in enough that points are far apart.
  const pointsPerPt = (to - from) / width;

  const paths = useMemo(
    () =>
      series.map(s => {
        const ys = yFor(s.domain ?? domain);
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
        return {...s, d};
      }),
    [series, from, to, width, height, startM, endM, domain],
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
  }, [band, from, to, width, height, startM, endM, domain]);

  // Apex-relative grids use the handoff's fixed 100 m ticks.
  const step = gridOriginM == null ? gridStepM(spanM, width) : 100;
  const gridMs: number[] = [];
  const origin = gridOriginM ?? 0;
  for (
    let m = origin + Math.ceil((startM - origin) / step) * step;
    m <= endM;
    m += step
  )
    gridMs.push(m);
  const tickLabel = (m: number) => {
    if (gridOriginM == null) return `${Math.round(m)}`;
    const d = Math.round(m - gridOriginM);
    return d === 0 ? '' : `${d > 0 ? '+' : '−'}${Math.abs(d)} m`;
  };

  // PanResponder reads its handlers once; keep the latest props in a ref.
  const latest = useRef({onScrub, onPan, onPanStart, startM, spanM, width});
  useEffect(() => {
    latest.current = {onScrub, onPan, onPanStart, startM, spanM, width};
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
        else
          p.onScrub?.(p.startM + (e.nativeEvent.locationX / p.width) * p.spanM);
      },
      onPanResponderMove: (e, g) => {
        const p = latest.current;
        if (p.onPan) {
          p.onPan(g.dx - lastDx.current);
          lastDx.current = g.dx;
        } else
          p.onScrub?.(p.startM + (e.nativeEvent.locationX / p.width) * p.spanM);
      },
    }),
  );

  const cx = ((cursorM - startM) / spanM) * width;
  const hx = hoverM == null ? null : ((hoverM - startM) / spanM) * width;
  // Pointer events exist on web; on native these props are ignored.
  const hoverProps = onHover
    ? {
        onPointerMove: (e: {
          nativeEvent: {offsetX?: number; locationX?: number};
        }) => {
          const px = e.nativeEvent.offsetX ?? e.nativeEvent.locationX ?? 0;
          onHover(startM + (px / width) * spanM);
        },
        onPointerLeave: () => onHover(null),
      }
    : {};
  const axis = typeScale.axis;
  return (
    <View
      {...responder.panHandlers}
      {...hoverProps}
      style={{width, height: height + AXIS_H}}>
      <Svg width={width} height={height + AXIS_H} pointerEvents='none'>
        {gridMs.map(m => {
          const gx = ((m - startM) / spanM) * width;
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
          const mx = ((mk.m - startM) / spanM) * width;
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
            x={((frameM[0] - startM) / spanM) * width}
            y={0.5}
            width={Math.max(2, ((frameM[1] - frameM[0]) / spanM) * width)}
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
            y1={y(0)}
            y2={y(0)}
            stroke={color.median}
            strokeWidth={stroke.mark}
          />
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
