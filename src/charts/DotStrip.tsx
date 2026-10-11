import {useMemo} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Circle, Line, Rect} from 'react-native-svg';

import {stackDots} from '@/src/analysis/dotStack';
import {space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import {ChartLabel, ChartSvg, TICK_PT} from './ChartLabel';
import {baselineUnder, DESCENT_EM, EDGE_PT} from './labelBox';
import {type Scale} from './scale';
import {stripAxis} from './stripAxis';

// One measure across many laps (handoff §4 "dot strips", pit-wall thread 27
// #621): a dot per lap on a line, with the p10–90 band and a median tick
// under the dots, an axis in 1-2-5 steps with units on its ticks (D45), and
// the direction words (and resolution) below. Dots stay on the line and stack
// only where they overlap. Pure props; the caller picks each dot's color and
// size.

export type StripDot = {
  key: string;
  value: number;
  color: string;
  r: number;
  opacity: number;
  /** Drawn last, on top. */
  top: boolean;
};

const STACK_PT = 3.5;
const BASE_H = 22;
const BAND_H = 8;
const MEDIAN_H = 14;
const HIT = 24;
// The axis under the dots: its line this far below the dot area, ticks this
// long under it, the labels hanging from the ticks.
const AXIS_GAP = 2;
const TICK_LEN = 4;

export function DotStrip({
  width,
  scale,
  flipped,
  band,
  coincidentWithin,
  resolution,
  leftWord,
  rightWord,
  dots,
  onPressDot,
  pressLabel,
}: {
  width: number;
  /** The axis: the values' range in 1-2-5 steps, ticks labelled with units. */
  scale: Scale;
  /** Left = larger values (brake point: left is earlier on the lap). */
  flipped: boolean;
  band: {p10: number; p50: number; p90: number} | null;
  /** Values this close are one point (the channel's resolution). */
  coincidentWithin: number;
  resolution: string | null;
  leftWord: string;
  rightWord: string;
  dots: StripDot[];
  onPressDot: (key: string) => void;
  pressLabel: (key: string) => string;
}) {
  const {color} = useTheme();
  const axis = useMemo(
    () => stripAxis(scale, width, flipped, TICK_PT),
    [scale, width, flipped],
  );
  const x = axis.x;
  const rows = useMemo(
    () =>
      stackDots(
        dots.map(d => ({x: x(d.value), value: d.value, priority: d.top})),
        Math.max(...dots.map(d => d.r * 2), 1),
        coincidentWithin,
      ),
    // x depends only on the axis.
    [dots, axis, coincidentWithin],
  );
  const maxRow = Math.max(0, ...rows.map(Math.abs));
  const h = BASE_H + 2 * maxRow * STACK_PT;
  const mid = h / 2;
  const drawn = dots
    .map((d, i) => ({...d, cx: x(d.value), cy: mid - rows[i] * STACK_PT}))
    .sort((a, b) => Number(a.top) - Number(b.top));
  const axisY = h + AXIS_GAP;
  const labelY = baselineUnder(axisY + TICK_LEN, TICK_PT);
  const svgH = Math.ceil(labelY + DESCENT_EM * TICK_PT + EDGE_PT);
  return (
    <View>
      <View style={{width, height: svgH}}>
        <ChartSvg width={width} height={svgH}>
          {band && (
            <Rect
              x={Math.min(x(band.p10), x(band.p90))}
              width={Math.abs(x(band.p90) - x(band.p10))}
              y={mid - BAND_H / 2}
              height={BAND_H}
              fill={color.band}
            />
          )}
          <Line
            x1={axis.padX}
            x2={width - axis.padX}
            y1={mid}
            y2={mid}
            stroke={color.lineStrong}
            strokeWidth={1}
          />
          <Line
            x1={axis.padX}
            x2={width - axis.padX}
            y1={axisY}
            y2={axisY}
            stroke={color.lineStrong}
            strokeWidth={1}
          />
          {axis.ticks.map(t => (
            <Line
              key={`t${t.v}`}
              x1={t.x}
              x2={t.x}
              y1={axisY}
              y2={axisY + TICK_LEN}
              stroke={color.lineStrong}
              strokeWidth={1}
            />
          ))}
          {axis.ticks
            .filter(t => t.labelled)
            .map(t => (
              <ChartLabel
                key={`l${t.v}`}
                x={t.x}
                y={labelY}
                anchor='middle'
                fontSize={TICK_PT}
                fill={color.textSecondary}>
                {t.label}
              </ChartLabel>
            ))}
          {band && (
            <Line
              x1={x(band.p50)}
              x2={x(band.p50)}
              y1={mid - MEDIAN_H / 2}
              y2={mid + MEDIAN_H / 2}
              stroke={color.textMuted}
              strokeWidth={1.5}
            />
          )}
          {drawn.map(d => (
            <Circle
              key={d.key}
              cx={d.cx}
              cy={d.cy}
              r={d.r}
              fill={d.color}
              opacity={d.opacity}
            />
          ))}
        </ChartSvg>
        {drawn.map(d => (
          <Pressable
            key={`hit-${d.key}`}
            accessibilityRole='button'
            accessibilityLabel={pressLabel(d.key)}
            onPress={() => onPressDot(d.key)}
            style={[styles.hit, {left: d.cx - HIT / 2, top: d.cy - HIT / 2}]}
          />
        ))}
      </View>
      <View
        style={[styles.ends, {width, paddingHorizontal: axis.padX - space.xs}]}>
        <Text variant='axis' tone='textMuted'>
          ← {leftWord}
        </Text>
        {resolution ? (
          <Text variant='axis' tone='textFaint'>
            {resolution}
          </Text>
        ) : null}
        <Text variant='axis' tone='textMuted'>
          {rightWord} →
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hit: {position: 'absolute', width: HIT, height: HIT},
  ends: {flexDirection: 'row', justifyContent: 'space-between'},
});
