import {View} from 'react-native';
import Svg, {Circle, G, Line, Text as SvgText} from 'react-native-svg';

import {
  dash,
  dotOpacity,
  stroke,
  type as typeScale,
  useTheme,
} from '@/src/design';

// Fuel used per lap against lap time (practice view, pit-wall thread 36). Pure
// props in, SVG out. Dots are neutral: colour has one meaning each, and lap
// colours mean laps. Faster is up, as on the lap-time chart. The x axis does not start at zero.

export type ScatterPoint = {
  key: string;
  x: number;
  y: number;
  /** An earlier session's lap: drawn fainter than this session's. */
  muted?: boolean;
};
export type ScatterTick = {v: number; label: string};

const PAD_L = 56;
const PAD_R = 12;
const PAD_T = 18;
const PAD_B = 32;
const DOT_R = 3;

export function FuelScatter({
  width,
  height,
  points,
  xDomain,
  yDomain,
  xTicks,
  yTicks,
  xTitle,
  yTitle,
  refX,
  fit,
}: {
  width: number;
  height: number;
  points: ScatterPoint[];
  xDomain: [number, number];
  /** Lap time in seconds; larger is slower and is drawn lower. */
  yDomain: [number, number];
  xTicks: ScatterTick[];
  yTicks: ScatterTick[];
  xTitle: string;
  yTitle: string;
  /** One dashed vertical reference line, labelled with where it comes from. */
  refX?: {x: number; label: string} | null;
  /** A least-squares line over the points, drawn dashed under the dots. */
  fit?: {x1: number; y1: number; x2: number; y2: number} | null;
}) {
  const {color} = useTheme();
  const axis = typeScale.axis;
  const plotW = Math.max(1, width - PAD_L - PAD_R);
  const plotH = Math.max(1, height - PAD_T - PAD_B);
  const xOf = (v: number) =>
    PAD_L + ((v - xDomain[0]) / (xDomain[1] - xDomain[0])) * plotW;
  const yOf = (v: number) =>
    PAD_T + ((v - yDomain[0]) / (yDomain[1] - yDomain[0])) * plotH;
  return (
    <View>
      <Svg width={width} height={height}>
        {yTicks.map(t => (
          <G key={`y${t.v}`}>
            <Line
              x1={PAD_L}
              x2={width - PAD_R}
              y1={yOf(t.v)}
              y2={yOf(t.v)}
              stroke={color.line}
              strokeWidth={stroke.grey}
            />
            <SvgText
              x={PAD_L - 6}
              y={yOf(t.v) + 3}
              textAnchor='end'
              fill={color.textMuted}
              fontFamily={axis.fontFamily}
              fontSize={axis.fontSize}>
              {t.label}
            </SvgText>
          </G>
        ))}
        {xTicks.map(t => (
          <G key={`x${t.v}`}>
            <Line
              x1={xOf(t.v)}
              x2={xOf(t.v)}
              y1={PAD_T}
              y2={PAD_T + plotH}
              stroke={color.line}
              strokeWidth={stroke.grey}
            />
            <SvgText
              x={xOf(t.v)}
              y={PAD_T + plotH + 12}
              textAnchor='middle'
              fill={color.textMuted}
              fontFamily={axis.fontFamily}
              fontSize={axis.fontSize}>
              {t.label}
            </SvgText>
          </G>
        ))}
        <SvgText
          x={PAD_L + plotW / 2}
          y={height - 4}
          textAnchor='middle'
          fill={color.textFaint}
          fontFamily={axis.fontFamily}
          fontSize={axis.fontSize}>
          {xTitle}
        </SvgText>
        <SvgText
          x={PAD_L}
          y={10}
          fill={color.textFaint}
          fontFamily={axis.fontFamily}
          fontSize={axis.fontSize}>
          {yTitle}
        </SvgText>
        {fit ? (
          <Line
            x1={xOf(fit.x1)}
            x2={xOf(fit.x2)}
            y1={yOf(fit.y1)}
            y2={yOf(fit.y2)}
            stroke={color.textSecondary}
            strokeWidth={stroke.mark}
            strokeDasharray={dash.mark}
          />
        ) : null}
        {points.map(p => (
          <Circle
            key={p.key}
            cx={xOf(p.x)}
            cy={yOf(p.y)}
            r={DOT_R}
            fill={color.textSecondary}
            fillOpacity={p.muted ? dotOpacity.earlier : dotOpacity.current}
          />
        ))}
        {refX ? (
          <G>
            <Line
              x1={xOf(refX.x)}
              x2={xOf(refX.x)}
              y1={PAD_T}
              y2={PAD_T + plotH}
              stroke={color.textSecondary}
              strokeWidth={1}
              strokeDasharray={dash.overlay2}
            />
            <SvgText
              x={xOf(refX.x) + (xOf(refX.x) > width / 2 ? -4 : 4)}
              y={PAD_T + 10}
              textAnchor={xOf(refX.x) > width / 2 ? 'end' : 'start'}
              fill={color.textSecondary}
              fontFamily={axis.fontFamily}
              fontSize={axis.fontSize}>
              {refX.label}
            </SvgText>
          </G>
        ) : null}
      </Svg>
    </View>
  );
}
