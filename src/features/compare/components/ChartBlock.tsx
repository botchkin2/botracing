import {useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import Svg, {Line} from 'react-native-svg';

import {type TraceSeries, TraceChart} from '@/src/charts';
import {dash, space, useTheme} from '@/src/design';
import {
  CHANNEL_IDS,
  type ChannelId,
  MAX_OVERLAY,
} from '@/src/state/comparePrefs';
import {Chip, Explainer, Text} from '@/src/ui';

import {
  CHANNELS,
  type ChartModel,
  type ChartTimeAxis,
  type ChartValueRow,
  drawRank,
} from '../model';

export type LapStyle = (
  selIndex: number,
  highlighted: boolean,
) => {color: string; width: number; opacity: number; key: boolean};

const OVERLAY_DASH = [undefined, dash.overlay2, dash.overlay3];

/** One chart: header with values at the cursor, the explainer, the traces. */
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
}) {
  const {color} = useTheme();
  // Other laps first, so the highlighted lap and the reference draw on top.
  const series: TraceSeries[] = chart.lines
    .map(l => {
      const s = lapStyle(l.selIndex, l.highlighted);
      return {
        key: `${l.channel}-${l.lapId}`,
        values: l.values,
        color: s.color,
        width: s.width,
        opacity: s.opacity,
        dash: OVERLAY_DASH[l.overlay],
        domain: chart.domains[l.channel],
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
          <Text variant='label' tone='textMuted'>
            {chart.title}
          </Text>
          {chart.valueRows.map(r => (
            <View key={r.channel} style={styles.overlayRow}>
              <Svg width={18} height={6}>
                <Line
                  x1={0}
                  x2={18}
                  y1={3}
                  y2={3}
                  stroke={color.textMuted}
                  strokeWidth={1.5}
                  strokeDasharray={OVERLAY_DASH[r.overlay]}
                />
              </Svg>
              <Text variant='dataSmall' tone='textMuted'>
                {r.label} {r.unit}
              </Text>
              {editor && (
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
        </View>
      )}
      <Explainer>{chart.explainer}</Explainer>
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
        zeroLine={chart.zeroLine}
        cursorM={cursorM}
        onScrub={onScrub}
        onPan={onPan}
        onPanStart={onPanStart}
        hoverM={hoverM}
        onHover={onHover}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {gap: space.xxs},
  headerRow: {flexDirection: 'row', alignItems: 'baseline', gap: space.sm},
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
