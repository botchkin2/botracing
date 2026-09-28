import {StyleSheet, View} from 'react-native';
import Svg, {Line} from 'react-native-svg';

import {type TraceSeries, TraceChart} from '@/src/charts';
import {dash, space, useTheme} from '@/src/design';
import {Explainer, Text} from '@/src/ui';

import {type ChartModel, drawRank} from '../model';

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
  cursorM,
  lapStyle,
  onScrub,
  onPan,
  onPanStart,
}: {
  chart: ChartModel;
  width: number;
  /** Plot height in points. */
  height: number;
  marks: {m: number; label: string}[];
  stepM: number;
  windowM: [number, number];
  cursorM: number;
  lapStyle: LapStyle;
  onScrub?: (m: number) => void;
  /** Set inside a window: dragging pans instead of scrubbing. */
  onPan?: (dxPt: number) => void;
  onPanStart?: () => void;
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

  return (
    <View style={styles.block}>
      {chart.valueRows.length === 1 ? (
        <View style={styles.headerRow}>
          <Text variant='label' tone='textMuted'>
            {chart.valueRows[0].label}
          </Text>
          <Text variant='dataSmall' tone='textFaint'>
            {chart.valueRows[0].unit}
          </Text>
          <View style={styles.values}>
            {chart.valueRows[0].values.map(v => (
              <Text
                key={v.lapId}
                variant='dataStrong'
                style={{color: lapStyle(v.selIndex, v.highlighted).color}}>
                {v.text}
              </Text>
            ))}
          </View>
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
              <View style={styles.values}>
                {r.values.map(v => (
                  <Text
                    key={v.lapId}
                    variant='dataStrong'
                    style={{color: lapStyle(v.selIndex, v.highlighted).color}}>
                    {v.text}
                  </Text>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}
      <Explainer>{chart.explainer}</Explainer>
      <TraceChart
        width={width}
        height={height}
        marks={marks}
        stepM={stepM}
        windowM={windowM}
        domain={chart.domains[first] ?? [0, 1]}
        series={series}
        band={chart.band ?? undefined}
        zeroLine={chart.zeroLine}
        cursorM={cursorM}
        onScrub={onScrub}
        onPan={onPan}
        onPanStart={onPanStart}
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
  values: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.md,
  },
});
