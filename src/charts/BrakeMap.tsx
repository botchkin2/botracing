import {useMemo} from 'react';
import Svg, {Circle, G, Path, Rect, Text as SvgText} from 'react-native-svg';

import {type as typeScale, useTheme} from '@/src/design';

// Zoomed corner map (handoff D3 "Where each lap braked"): a track band
// around one line, distance ticks, and a marker per lap. Inputs are metres
// east/north; this turns and fits them to the box (not north up).

type Xy = {x: number; y: number};

export type BrakeMapMarker = {
  key: string;
  at: Xy;
  shape: 'circle' | 'square';
  /** Circle radius, or square side, in points. */
  size: number;
  color: string;
  opacity: number;
};

const PAD = 22;
const BAND_W = 16;
// Never squeezed below this, so the markers and labels keep room.
const MIN_H = 96;

/**
 * The line turned so its first-to-last chord runs left to right (a corner
 * fills a wide box whatever its compass heading), and its extent after the turn.
 */
function turnedExtent(centreline: Xy[]) {
  const first = centreline[0];
  const last = centreline[centreline.length - 1];
  const angle = Math.atan2(last.y - first.y, last.x - first.x);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const turn = (p: Xy) => ({
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
  });
  const turned = centreline.map(turn);
  const xs = turned.map(p => p.x);
  const ys = turned.map(p => p.y);
  const minX = Math.min(...xs);
  const maxY = Math.max(...ys);
  return {
    turn,
    minX,
    maxY,
    spanX: Math.max(...xs) - minX || 1,
    spanY: maxY - Math.min(...ys) || 1,
  };
}

/**
 * The height that fits the line's own extent at the width given (plus the
 * padding), never taller than `maxHeight`: a flat arc does not need a box as
 * tall as a hairpin.
 */
export function brakeMapHeight(
  width: number,
  centreline: Xy[],
  maxHeight: number,
): number {
  if (centreline.length < 2) return maxHeight;
  const {spanX, spanY} = turnedExtent(centreline);
  const fitted = Math.ceil(((width - 2 * PAD) / spanX) * spanY + 2 * PAD);
  return Math.min(maxHeight, Math.max(MIN_H, fitted));
}
// The track band outside this turn's stretch.
const DIM_OPACITY = 0.45;

export function BrakeMap({
  width,
  height,
  centreline,
  stretch,
  neighbours,
  apex,
  ticks,
  markers,
}: {
  width: number;
  height: number;
  centreline: Xy[];
  /** First and last centreline index of this turn's own stretch, if any. The
   *  rest of the line is dimmed. */
  stretch?: [number, number] | null;
  /** Neighbouring apexes, named ("T9 apex"). */
  neighbours?: {label: string; at: Xy}[];
  apex: Xy;
  ticks: {label: string; at: Xy}[];
  /** Drawn in order; put key laps last so they sit on top. */
  markers: BrakeMapMarker[];
}) {
  const {color} = useTheme();

  // Rotate so the line from the first to the last point runs left to right:
  // a corner fills the wide box whatever its compass heading.
  const fit = useMemo(() => {
    const {turn, minX, maxY, spanX, spanY} = turnedExtent(centreline);
    const scale = Math.min(
      (width - 2 * PAD) / spanX,
      (height - 2 * PAD) / spanY,
    );
    const offX = (width - spanX * scale) / 2;
    const offY = (height - spanY * scale) / 2;
    return (p: Xy) => {
      const q = turn(p);
      return {
        x: offX + (q.x - minX) * scale,
        y: offY + (maxY - q.y) * scale,
      };
    };
  }, [centreline, width, height]);

  const pathOf = (points: Xy[]) =>
    points
      .map((p, i) => {
        const q = fit(p);
        return `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
      })
      .join('');
  const d = pathOf(centreline);
  const own = stretch
    ? pathOf(centreline.slice(stretch[0], stretch[1] + 1))
    : null;
  const a = fit(apex);
  const label = {
    fill: color.textFaint,
    fontFamily: typeScale.dataSmall.fontFamily,
    fontSize: 9,
  };

  return (
    <Svg width={width} height={height}>
      <Path
        d={d}
        stroke={color.track}
        strokeWidth={BAND_W}
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeOpacity={own ? DIM_OPACITY : 1}
        fill='none'
      />
      {own && (
        <Path
          d={own}
          stroke={color.accentTint}
          strokeWidth={BAND_W}
          strokeLinecap='butt'
          strokeLinejoin='round'
          fill='none'
        />
      )}
      <Path
        d={d}
        stroke={color.textFaint}
        strokeWidth={1}
        strokeDasharray='4 4'
        fill='none'
      />
      {ticks.map(t => {
        const p = fit(t.at);
        return (
          <G key={t.label}>
            <Circle cx={p.x} cy={p.y} r={1.5} fill={color.textFaint} />
            <SvgText {...label} x={p.x + BAND_W / 2 + 2} y={p.y - 2}>
              {t.label}
            </SvgText>
          </G>
        );
      })}
      {(neighbours ?? []).map(n => {
        const p = fit(n.at);
        return (
          <G key={n.label}>
            <Circle cx={p.x} cy={p.y} r={1.5} fill={color.textFaint} />
            <SvgText {...label} x={p.x + BAND_W / 2 + 2} y={p.y - 2}>
              {n.label}
            </SvgText>
          </G>
        );
      })}
      <Circle cx={a.x} cy={a.y} r={2} fill={color.text} />
      <SvgText
        {...label}
        fill={color.text}
        x={a.x + BAND_W / 2 + 2}
        y={a.y - 2}>
        APEX
      </SvgText>
      {markers.map(m => {
        const p = fit(m.at);
        return m.shape === 'circle' ? (
          <Circle
            key={m.key}
            cx={p.x}
            cy={p.y}
            r={m.size}
            fill={m.color}
            opacity={m.opacity}
          />
        ) : (
          <Rect
            key={m.key}
            x={p.x - m.size / 2}
            y={p.y - m.size / 2}
            width={m.size}
            height={m.size}
            fill={m.color}
            opacity={m.opacity}
          />
        );
      })}
    </Svg>
  );
}
