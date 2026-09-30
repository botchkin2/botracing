import {View} from 'react-native';
import Svg, {Circle, G, Line, Text as SvgText} from 'react-native-svg';

import {stroke, type as typeScale, useTheme} from '@/src/design';

// Fuel used per lap against lap time (practice view, pit-wall thread 36). Pure
// props in, SVG out. Dots are neutral: colour has one meaning each, and lap
// colours mean laps, so a stint is told by its label at its median. Faster is
// up, as on the lap-time chart. The x axis does not start at zero.

export type ScatterPoint = {key: string; x: number; y: number; hollow: boolean};
export type ScatterMedian = {key: string; label: string; x: number; y: number};
export type ScatterTick = {v: number; label: string};

const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 18;
const PAD_B = 32;
const DOT_R = 3;
const MEDIAN_R = 6;

export function FuelScatter({
  width,
  height,
  points,
  medians,
  xDomain,
  yDomain,
  xTicks,
  yTicks,
  xTitle,
  yTitle,
}: {
  width: number;
  height: number;
  points: ScatterPoint[];
  medians: ScatterMedian[];
  xDomain: [number, number];
  /** Lap time in seconds; larger is slower and is drawn lower. */
  yDomain: [number, number];
  xTicks: ScatterTick[];
  yTicks: ScatterTick[];
  xTitle: string;
  yTitle: string;
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
        {points.map(p =>
          p.hollow ? (
            <Circle
              key={p.key}
              cx={xOf(p.x)}
              cy={yOf(p.y)}
              r={DOT_R}
              fill='none'
              stroke={color.textSecondary}
              strokeWidth={1}
            />
          ) : (
            <Circle
              key={p.key}
              cx={xOf(p.x)}
              cy={yOf(p.y)}
              r={DOT_R}
              fill={color.textSecondary}
              fillOpacity={0.7}
            />
          ),
        )}
        {medians.map(m => (
          <G key={m.key}>
            <Circle
              cx={xOf(m.x)}
              cy={yOf(m.y)}
              r={MEDIAN_R}
              fill='none'
              stroke={color.text}
              strokeWidth={1.5}
            />
            <SvgText
              x={xOf(m.x) + MEDIAN_R + 3}
              y={yOf(m.y) - MEDIAN_R}
              fill={color.text}
              fontFamily={axis.fontFamily}
              fontSize={axis.fontSize}>
              {m.label}
            </SvgText>
          </G>
        ))}
      </Svg>
    </View>
  );
}
