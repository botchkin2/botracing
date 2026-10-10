import {useMemo} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import Svg, {Circle, Line, Rect} from 'react-native-svg';

import {stackDots} from '@/src/analysis/dotStack';
import {space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

// One measure across many laps (handoff §4 "dot strips", pit-wall thread 27
// #621): a dot per lap on a line, with the p10–90 band and a median tick
// under the dots, the end values (and resolution) and direction words
// below. Dots stay on the line and stack only where they overlap. Pure
// props; the caller picks each dot's color and size.

export type StripDot = {
  key: string;
  value: number;
  color: string;
  r: number;
  opacity: number;
  /** Drawn last, on top. */
  top: boolean;
};

const PAD_X = 8;
const STACK_PT = 3.5;
const BASE_H = 22;
const BAND_H = 8;
const MEDIAN_H = 14;
const HIT = 24;

export function DotStrip({
  width,
  min,
  max,
  flipped,
  band,
  coincidentWithin,
  minLabel,
  maxLabel,
  midLabel,
  unit,
  resolution,
  leftWord,
  rightWord,
  dots,
  onPressDot,
  pressLabel,
}: {
  width: number;
  min: number;
  max: number;
  /** Left = larger values (brake point: left is earlier on the lap). */
  flipped: boolean;
  band: {p10: number; p50: number; p90: number} | null;
  /** Values this close are one point (the channel's resolution). */
  coincidentWithin: number;
  minLabel: string;
  maxLabel: string;
  /** The centre value, printed under the middle tick. */
  midLabel: string;
  /** Printed after each end value, so the scale reads in units. */
  unit: string;
  resolution: string | null;
  leftWord: string;
  rightWord: string;
  dots: StripDot[];
  onPressDot: (key: string) => void;
  pressLabel: (key: string) => string;
}) {
  const {color} = useTheme();
  const span = max - min || 1;
  const x = (v: number) => {
    const f = (v - min) / span;
    return PAD_X + (flipped ? 1 - f : f) * (width - 2 * PAD_X);
  };
  const rows = useMemo(
    () =>
      stackDots(
        dots.map(d => ({x: x(d.value), value: d.value, priority: d.top})),
        Math.max(...dots.map(d => d.r * 2), 1),
        coincidentWithin,
      ),
    // x depends only on these.
    [dots, width, min, max, flipped, coincidentWithin],
  );
  const maxRow = Math.max(0, ...rows.map(Math.abs));
  const h = BASE_H + 2 * maxRow * STACK_PT;
  const mid = h / 2;
  const drawn = dots
    .map((d, i) => ({...d, cx: x(d.value), cy: mid - rows[i] * STACK_PT}))
    .sort((a, b) => Number(a.top) - Number(b.top));
  const [leftVal, rightVal] = flipped
    ? [maxLabel, minLabel]
    : [minLabel, maxLabel];
  const withUnit = (v: string) => (unit ? `${v} ${unit}` : v);
  return (
    <View>
      <View style={{width, height: h}}>
        <Svg width={width} height={h}>
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
            x1={PAD_X}
            x2={width - PAD_X}
            y1={mid}
            y2={mid}
            stroke={color.lineStrong}
            strokeWidth={1}
          />
          {[PAD_X, x((min + max) / 2), width - PAD_X].map(tx => (
            <Line
              key={`t${tx}`}
              x1={tx}
              x2={tx}
              y1={mid + 3}
              y2={mid + 7}
              stroke={color.lineStrong}
              strokeWidth={1}
            />
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
        </Svg>
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
      <View style={[styles.ends, {width}]}>
        <Text variant='axis' tone='textSecondary'>
          {withUnit(leftVal)}
        </Text>
        {resolution ? (
          <Text variant='axis' tone='textFaint'>
            {resolution}
          </Text>
        ) : null}
        <Text variant='axis' tone='textSecondary'>
          {withUnit(rightVal)}
        </Text>
      </View>
      <View style={[styles.ends, {width}]}>
        <View />
        <Text variant='axis' tone='textFaint'>
          {withUnit(midLabel)}
        </Text>
        <View />
      </View>
      <View style={[styles.ends, {width}]}>
        <Text variant='axis' tone='textMuted'>
          ← {leftWord}
        </Text>
        <Text variant='axis' tone='textMuted'>
          {rightWord} →
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hit: {position: 'absolute', width: HIT, height: HIT},
  ends: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: PAD_X - space.xs,
  },
});
