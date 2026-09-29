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
  resets = [],
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
  /** Bar indexes (0-based) of laps a reset to the garage cut short. */
  resets?: number[];
  onPressBar: (key: string) => void;
}) {
  const {color} = useTheme();
  const n = Math.max(1, bars.length);
  const plotW = Math.max(0, width - GUTTER_W);
  const slot = plotW / n;
  const barW = Math.max(1, slot - 1.6);
  const plotBottom = height - STUB_BOTTOM - STUB_H - 4;
  const mid = TOP_PAD + (plotBottom - TOP_PAD) / 2;
  const half = (plotBottom - TOP_PAD) / 2;
  const yOf = (d: number) => mid - (d / rangeS) * half;
  const xOf = (i: number) => i * slot + (slot - barW) / 2;
  const axis = {...typeScale.axis, fontSize: 9};
  // STINT, PIT and RESET labels share the top rows; one that would run into
  // the label before it drops a row (freeze, thread 32: laps 32–34).
  // Each stint label says why the stint started: the lap before it was cut
  // short by a reset, or a pit within NEAR_LAPS before it ("STINT 5 · PIT").
  // That pit's own text folds in (its lines stay).
  const resetSet = new Set(resets);
  const pitBefore = (afterIndex: number) =>
    pits.some(i => afterIndex >= i && afterIndex - i < NEAR_LAPS);
  const why = (afterIndex: number) =>
    resetSet.has(afterIndex) ? 'RESET' : pitBefore(afterIndex) ? 'PIT' : null;
  const pitNearStint = (i: number) =>
    stintBreaks.some(b => b.afterIndex >= i && b.afterIndex - i < NEAR_LAPS);
  const pitLabels = pits.filter(i => !pits.includes(i - 1) && !pitNearStint(i));
  const topLabels = placeTopLabels(
    [
      ...stintBreaks.map(b => {
        const w = why(b.afterIndex);
        return {
          key: `s-${b.label}`,
          x: (b.afterIndex + 1) * slot + 3,
          text: w ? `${b.label} · ${w}` : b.label,
          color: w === 'PIT' ? color.accentInk : color.textMuted,
        };
      }),
      ...pitLabels.map(i => ({
        key: `p-${i}`,
        x: xOf(i) + barW / 2 + 3,
        text: 'PIT',
        color: color.accentInk,
      })),
    ],
    // Labels may use the median gutter; only past the chart edge do they
    // flip to end at their line.
    width,
  );

  return (
    <View style={{width, height: height + AXIS_H}}>
      <Svg width={width} height={height + AXIS_H}>
        {/* A stint a reset opened: grey long dashes, not the plain rule.
            A reset inside a stint gets no line, only its tag (Botkin #609). */}
        {stintBreaks.map(b => {
          const x = (b.afterIndex + 1) * slot;
          const reset = resetSet.has(b.afterIndex);
          return (
            <Line
              key={b.label}
              x1={x}
              x2={x}
              y1={0}
              y2={height}
              stroke={reset ? color.textMuted : color.lineHeader}
              strokeWidth={1}
              strokeDasharray={reset ? dash.mark : undefined}
            />
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
            <Line
              key={`pit-${i}`}
              x1={x}
              x2={x}
              y1={TOP_PAD}
              y2={height}
              stroke={color.accent}
              strokeWidth={1}
              strokeDasharray={dash.pit}
            />
          );
        })}
        {topLabels.map(l => (
          <SvgText
            key={l.key}
            x={l.x}
            textAnchor={l.anchor}
            y={9 + l.row * LABEL_ROW}
            fill={l.color}
            fontFamily={axis.fontFamily}
            fontSize={axis.fontSize}>
            {l.text}
          </SvgText>
        ))}
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

const LABEL_ROW = 10;
// A pit this many laps before a stint boundary is named by its label.
const NEAR_LAPS = 3;
// Mono 9 pt glyphs are ~5.6 pt wide.
const LABEL_CHAR_W = 5.6;

type TopLabel = {key: string; x: number; text: string; color: string};

/**
 * Left to right, each label takes the first row where it clears the last.
 * One that would run past maxX is drawn right-aligned, ending at its line.
 */
function placeTopLabels(
  labels: TopLabel[],
  maxX: number,
): (TopLabel & {row: number; anchor: 'start' | 'end'})[] {
  const rowEnds: number[] = [];
  return [...labels]
    .sort((a, b) => a.x - b.x)
    .map(l => {
      const w = l.text.length * LABEL_CHAR_W;
      const flip = l.x + w > maxX;
      const left = flip ? l.x - 6 - w : l.x;
      let row = rowEnds.findIndex(end => end + 4 <= left);
      if (row < 0) row = rowEnds.length;
      rowEnds[row] = left + w;
      return {
        ...l,
        x: flip ? l.x - 6 : l.x,
        row,
        anchor: flip ? 'end' : 'start',
      };
    });
}
