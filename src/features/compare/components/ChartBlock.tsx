import {type ReactNode, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import Svg, {Line, Rect} from 'react-native-svg';

import {type NativeSamples} from '@/src/analysis/nativeSamples';
import {type TraceSeries, TraceChart} from '@/src/charts';
import {screenLateral, toScreenLateral} from '@/src/charts/screenLateral';
import {dash, space, useTheme} from '@/src/design';
import {
  CHANNEL_IDS,
  type ChannelId,
  MAX_OVERLAY,
} from '@/src/state/comparePrefs';
import {Chip, Text} from '@/src/ui';

import {
  CHANNELS,
  type ChartModel,
  type ChartTimeAxis,
  type ChartValueRow,
  drawRank,
  STEER_TICKS,
} from '../model';

/** "off scale: L1, L2" for the laps a fitted scale clips, by channel. */
function offScaleNote(off: ChartModel['offScale']): string | null {
  const names = Object.values(off).flat();
  if (!names || names.length === 0) return null;
  return `off scale: ${[...new Set(names)].join(', ')}`;
}

export type LapStyle = (
  selIndex: number,
  highlighted: boolean,
) => {color: string; width: number; opacity: number; key: boolean};

const OVERLAY_DASH = [undefined, dash.overlay2, dash.overlay3];
// Round 3 R4a: brake fill at 16%, steering as a 1.2 pt line.
const BRAKE_FILL = 0.16;
const STEER_WIDTH = 1.2;

/** One chart: header with values at the cursor, the traces. */
export function ChartBlock({
  chart,
  width,
  height,
  marks,
  stepM,
  windowM,
  timeAxis,
  cursorM,
  lapStyle,
  onScrub,
  onPan,
  onPanStart,
  hoverM,
  onHover,
  hoverValues,
  editor,
  plotFirst,
  overlay,
}: {
  chart: ChartModel;
  width: number;
  /** Plot height in points. */
  height: number;
  marks: {m: number; label: string; solid?: boolean}[];
  stepM: number;
  windowM: [number, number];
  timeAxis?: ChartTimeAxis;
  cursorM: number;
  lapStyle: LapStyle;
  onScrub?: (m: number) => void;
  /** Set inside a window: dragging pans instead of scrubbing. */
  onPan?: (dxPt: number) => void;
  onPanStart?: () => void;
  hoverM?: number | null;
  onHover?: (m: number | null) => void;
  /** Header values at the hover point, replacing the cursor values. */
  hoverValues?: Partial<Record<ChannelId, ChartValueRow['values']>>;
  /** Desktop: the header is its own editor (× per channel, + overlay). */
  editor?: {onToggle: (ch: ChannelId) => void};
  /**
   * Phone: the plot sits right under the title, and the values per channel come
   * below it (Botkin watches the lines, not the numbers;
   * pit-wall thread 41 #1178).
   */
  plotFirst?: boolean;
  /** Drawn over the plot's top right corner (the radar on the phone). */
  overlay?: ReactNode;
}) {
  const {color} = useTheme();
  // Other laps first, so the highlighted lap and the reference draw on top.
  const series: TraceSeries[] = chart.lines
    .map(l => {
      const s = lapStyle(l.selIndex, l.highlighted);
      // Steering draws right DOWN (charts/screenLateral.ts); the data is +right.
      const flip = l.channel === 'steering';
      const screen = <T extends NativeSamples | undefined>(x: T) =>
        flip && x ? (screenLateral(x) as T) : x;
      return {
        key: `${l.channel}-${l.lapId}`,
        values: flip ? l.values.map(toScreenLateral) : l.values,
        samples: screen(l.samples),
        before: screen(l.before),
        after: screen(l.after),
        color: s.color,
        width:
          chart.pedals && l.channel === 'steering'
            ? Math.min(s.width, STEER_WIDTH)
            : s.width,
        opacity: s.opacity,
        // Pedals: no dashes; brake is a fill, steering a thin line.
        dash: chart.pedals ? undefined : OVERLAY_DASH[l.overlay],
        fill: chart.pedals && l.channel === 'brake' ? BRAKE_FILL : undefined,
        domain: chart.domains[l.channel],
        // The steering band carries its own frame: L 100, 0, R 100.
        ticks:
          chart.pedals && l.channel === 'steering' ? STEER_TICKS : undefined,
        rank: drawRank(l),
        stepped: l.channel === 'gear',
      };
    })
    .sort((a, b) => a.rank - b.rank);
  const first = chart.channels[0];
  // D2: one "+ overlay" chip per header; the channel pills open on tap.
  const [pillsOpen, setPillsOpen] = useState(false);
  const valuesOf = (row: ChartValueRow) =>
    hoverValues?.[row.channel] ?? row.values;
  const valueTexts = (row: ChartValueRow) => (
    <View style={styles.values}>
      {valuesOf(row).map(v => (
        <Text
          key={v.lapId}
          variant='dataStrong'
          style={{color: lapStyle(v.selIndex, v.highlighted).color}}>
          {v.text}
        </Text>
      ))}
    </View>
  );

  // A lone chart's × removes the whole chart, so it sits on the title row,
  // not beside the value (ratchet, #411 review).
  const loneEditor = !!editor && chart.channels.length === 1;
  const titleRow = (
    <View style={styles.titleRow}>
      <Text variant='label' tone='textMuted'>
        {chart.title}
      </Text>
      {offScaleNote(chart.offScale) ? (
        <Text variant='dataSmall' tone='textFaint'>
          {offScaleNote(chart.offScale)}
        </Text>
      ) : null}
      {loneEditor && (
        <Pressable
          accessibilityLabel={`Remove ${chart.title}`}
          hitSlop={space.sm}
          onPress={() => editor.onToggle(first)}>
          <Text variant='dataSmall' tone='textFaint'>
            ×
          </Text>
        </Pressable>
      )}
    </View>
  );
  const valueRows = (
    <>
      {chart.valueRows.map(r => (
        <View key={r.channel} style={styles.overlayRow}>
          {r.legend && (
            <>
              <LegendSwatch
                kind={
                  chart.pedals && r.channel === 'brake'
                    ? 'fill'
                    : chart.pedals && r.channel === 'steering'
                    ? 'band'
                    : 'line'
                }
                dash={chart.pedals ? undefined : OVERLAY_DASH[r.overlay]}
                color={color.textMuted}
              />
              <Text variant='dataSmall' tone='textMuted'>
                {r.label} {r.unit}
              </Text>
            </>
          )}
          {editor && !loneEditor && (
            <Pressable
              accessibilityLabel={`Remove ${r.label}`}
              hitSlop={space.sm}
              onPress={() => editor.onToggle(r.channel)}>
              <Text variant='dataSmall' tone='textFaint'>
                ×
              </Text>
            </Pressable>
          )}
          {valueTexts(r)}
        </View>
      ))}
      {editor && chart.channels.length < MAX_OVERLAY && (
        <View style={styles.pills}>
          <Chip
            dashed
            label='+ overlay'
            selected={pillsOpen}
            onPress={() => setPillsOpen(o => !o)}
          />
          {pillsOpen &&
            CHANNEL_IDS.filter(c => !chart.channels.includes(c)).map(c => (
              <Chip
                key={c}
                label={CHANNELS[c].label}
                onPress={() => {
                  editor.onToggle(c);
                  setPillsOpen(false);
                }}
              />
            ))}
        </View>
      )}
    </>
  );
  const plot = (
    <View>
      <TraceChart
        width={width}
        height={height}
        marks={marks}
        stepM={stepM}
        windowM={windowM}
        timeAxis={timeAxis}
        domain={chart.domains[first] ?? [0, 1]}
        series={series}
        band={chart.band ?? undefined}
        zeroLine={chart.zeroLine != null}
        zeroDomain={chart.zeroLine ? chart.domains[chart.zeroLine] : undefined}
        cursorM={cursorM}
        onScrub={onScrub}
        onPan={onPan}
        onPanStart={onPanStart}
        hoverM={hoverM}
        onHover={onHover}
      />
      {overlay}
    </View>
  );

  if (plotFirst)
    return (
      <View style={styles.block}>
        {titleRow}
        {plot}
        <View>{valueRows}</View>
      </View>
    );

  return (
    <View style={styles.block}>
      {chart.valueRows.length === 1 && !editor ? (
        <View style={styles.headerRow}>
          <Text variant='label' tone='textMuted'>
            {chart.valueRows[0].label}
          </Text>
          <Text variant='dataSmall' tone='textFaint'>
            {chart.valueRows[0].unit}
          </Text>
          {valueTexts(chart.valueRows[0])}
        </View>
      ) : (
        <View>
          {titleRow}
          {valueRows}
        </View>
      )}
      {plot}
    </View>
  );
}

// What the row's channel looks like on the chart: a line, the brake's filled
// area, or steering's thin line over its band's zero tick.
function LegendSwatch({
  kind,
  dash: dashArray,
  color,
}: {
  kind: 'line' | 'fill' | 'band';
  dash?: string;
  color: string;
}) {
  return (
    <Svg width={18} height={8}>
      {kind === 'fill' && (
        <Rect x={0} y={1} width={18} height={6} fill={color} opacity={0.3} />
      )}
      {kind === 'band' && (
        <Line x1={0} x2={18} y1={4} y2={4} stroke={color} opacity={0.5} />
      )}
      <Line
        x1={0}
        x2={18}
        y1={kind === 'fill' ? 1 : kind === 'band' ? 2 : 4}
        y2={kind === 'fill' ? 1 : kind === 'band' ? 6 : 4}
        stroke={color}
        strokeWidth={kind === 'band' ? 1.2 : 1.5}
        strokeDasharray={dashArray}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  block: {gap: space.xxs},
  headerRow: {flexDirection: 'row', alignItems: 'baseline', gap: space.sm},
  titleRow: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  overlayRow: {
    height: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  pills: {flexDirection: 'row', flexWrap: 'wrap', gap: space.xs},
  // Next to the label, not at the far edge: at 1440 the edge is ~1,300 pt
  // from the label (Botkin, thread 26 #385).
  values: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    marginLeft: space.sm,
  },
});
