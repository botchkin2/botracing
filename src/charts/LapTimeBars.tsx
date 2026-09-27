import {Pressable, StyleSheet, View} from 'react-native';
import Svg, {G, Line, Rect, Text as SvgText} from 'react-native-svg';

import {dash, stroke, type as typeScale, useTheme} from '@/src/design';

// One bar per lap around the median (handoff §2 "Lap times chart"). Up is
// faster. Excluded laps are outlined stubs on the baseline. Pure props: the
// caller decides each bar's color.

export type LapBar = {
  key: string;
  /** Spoken name, e.g. "L17". */
  label: string;
  /** Median minus lap time, already clamped to ±rangeS. */
  deltaS: number;
  excluded: boolean;
  fill: string;
  highlighted: boolean;
};

const STUB_H = 9;
const STUB_BOTTOM = 14;
const AXIS_H = 14;
const TOP_PAD = 12;
// Right gutter for the median label, so bars never sit under it.
const GUTTER_W = 40;

export function LapTimeBars({
  width,
  height,
  bars,
  rangeS,
  medianLabel,
  stintBreaks,
  pits,
  onPressBar,
}: {
  width: number;
  height: number;
  bars: LapBar[];
  rangeS: number;
  medianLabel: string;
  /** Bar index (0-based) after which a stint rule is drawn. */
  stintBreaks: {afterIndex: number; label: string}[];
  /** Bar indexes (0-based) of pit-in laps. */
  pits: number[];
  onPressBar: (key: string) => void;
}) {
  const {color} = useTheme();
  const n = Math.max(1, bars.length);
  const plotW = width - GUTTER_W;
  const slot = plotW / n;
  const barW = Math.max(1, slot - 1.6);
  const plotBottom = height - STUB_BOTTOM - STUB_H - 4;
  const mid = TOP_PAD + (plotBottom - TOP_PAD) / 2;
  const half = (plotBottom - TOP_PAD) / 2;
  const yOf = (d: number) => mid - (d / rangeS) * half;
  const xOf = (i: number) => i * slot + (slot - barW) / 2;
  const axis = {...typeScale.axis, fontSize: 9};

  return (
    <View style={{width, height: height + AXIS_H}}>
      <Svg width={width} height={height + AXIS_H}>
        {stintBreaks.map(b => {
          const x = (b.afterIndex + 1) * slot;
          return (
            <G key={b.label}>
              <Line
                x1={x}
                x2={x}
                y1={0}
                y2={height}
                stroke={color.lineHeader}
                strokeWidth={1}
              />
              <SvgText
                x={x + 3}
                y={9}
                fill={color.textFaint}
                fontFamily={axis.fontFamily}
                fontSize={axis.fontSize}>
                {b.label}
              </SvgText>
            </G>
          );
        })}
        <Line
          x1={0}
          x2={width}
          y1={mid}
          y2={mid}
          stroke={color.median}
          strokeWidth={stroke.mark}
        />

        {pits.map(i => {
          const x = xOf(i) + barW / 2;
          return (
            <G key={`pit-${i}`}>
              <Line
                x1={x}
                x2={x}
                y1={TOP_PAD}
                y2={height}
                stroke={color.accent}
                strokeWidth={1}
                strokeDasharray={dash.pit}
              />
              <SvgText
                x={x + 3}
                y={TOP_PAD + 8}
                fill={color.accentInk}
                fontFamily={axis.fontFamily}
                fontSize={axis.fontSize}>
                PIT
              </SvgText>
            </G>
          );
        })}
        {bars.map((b, i) => {
          const x = xOf(i);
          if (b.excluded) {
            const y = height - STUB_BOTTOM - STUB_H;
            return (
              <Rect
                key={b.key}
                x={x + 0.5}
                y={y}
                width={Math.max(0.5, barW - 1)}
                height={STUB_H}
                fill={color.bg}
                stroke={b.highlighted ? color.accent : color.textMuted}
                strokeWidth={b.highlighted ? 1.5 : 1}
              />
            );
          }
          const y = Math.min(mid, yOf(b.deltaS));
          const h = Math.max(1, Math.abs(yOf(b.deltaS) - mid));
          return (
            <G key={b.key}>
              {b.highlighted && (
                <Rect
                  x={x - 2}
                  y={y - 2}
                  width={barW + 4}
                  height={h + 4}
                  fill={color.accentTint}
                  stroke={color.accent}
                  strokeWidth={1.5}
                />
              )}
              <Rect x={x} y={y} width={barW} height={h} fill={b.fill} />
            </G>
          );
        })}
        <SvgText
          x={width}
          y={mid + 3}
          textAnchor='end'
          fill={color.textFaint}
          fontFamily={axis.fontFamily}
          fontSize={axis.fontSize}>
          {medianLabel}
        </SvgText>
        {bars.map((b, i) =>
          (i + 1) % 10 === 0 ? (
            <SvgText
              key={`x-${i}`}
              x={xOf(i) + barW / 2}
              y={height + AXIS_H - 3}
              textAnchor='middle'
              fill={color.textFaint}
              fontFamily={axis.fontFamily}
              fontSize={axis.fontSize}>
              {i + 1}
            </SvgText>
          ) : null,
        )}
      </Svg>
      {/* Hit targets: full-height columns, so thin bars are still tappable. */}
      <View style={StyleSheet.absoluteFill}>
        <View style={styles.hitRow}>
          {bars.map(b => (
            <Pressable
              key={b.key}
              accessibilityRole='button'
              accessibilityLabel={b.label}
              onPress={() => onPressBar(b.key)}
              style={{width: slot, height}}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({hitRow: {flexDirection: 'row'}});
