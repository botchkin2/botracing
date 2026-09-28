import {Modal, Pressable, ScrollView, StyleSheet, View} from 'react-native';
import Svg, {Line} from 'react-native-svg';

import {dash, radius, space, useLayout, useTheme} from '@/src/design';
import {
  addChart,
  CHANNEL_IDS,
  type ChannelId,
  type ChartSet,
  MAX_OVERLAY,
  moveChart,
  PRESETS,
  removeChart,
  toggleChannel,
} from '@/src/state/comparePrefs';
import {Button, Chip, Text} from '@/src/ui';

import {CHANNELS} from '../model';

const OVERLAY_DASH = [undefined, dash.overlay2, dash.overlay3];
const SIDE_SHEET_W = 380;

/**
 * Edit charts (handoff §3): presets, one row per chart with its channels,
 * "+ overlay", reorder and delete, and "+ Add chart". A bottom sheet on the
 * phone and a right-side sheet on desktop.
 */
export function ChartEditor({
  visible,
  charts,
  onChange,
  onClose,
}: {
  visible: boolean;
  charts: ChartSet;
  onChange: (charts: ChartSet) => void;
  onClose: () => void;
}) {
  const {color} = useTheme();
  const layout = useLayout();
  const unused = (chart: ChannelId[]) =>
    CHANNEL_IDS.filter(c => !chart.includes(c));

  return (
    <Modal
      visible={visible}
      transparent
      animationType='fade'
      onRequestClose={onClose}>
      <View style={[styles.scrim, {backgroundColor: color.scrim}]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            layout.isDesktop ? styles.side : styles.bottom,
            layout.isDesktop && {width: SIDE_SHEET_W},
            {backgroundColor: color.surfaceOverlay},
          ]}>
          <View style={styles.header}>
            <Text variant='title' style={styles.flex}>
              Edit charts
            </Text>
            <Button label='Done' onPress={onClose} />
          </View>
          <Text variant='explainer' tone='textMuted'>
            Each row is one chart. Put up to 3 channels on a chart to overlay
            them. The first is solid, the second dashed, the third dotted. Laps
            keep their colors.
          </Text>
          <View style={styles.wrap}>
            <Text variant='label' tone='textMuted'>
              Presets
            </Text>
            {PRESETS.map(p => (
              <Chip
                key={p.id}
                label={p.label}
                onPress={() => onChange(p.charts)}
              />
            ))}
          </View>
          <ScrollView contentContainerStyle={styles.rows}>
            {charts.map((chart, i) => (
              <View
                key={`${i}-${chart.join('+')}`}
                style={[styles.chartRow, {borderColor: color.line}]}>
                <View style={styles.rowTop}>
                  <Text variant='dataStrong' tone='textMuted'>
                    {i + 1}
                  </Text>
                  <View style={[styles.wrap, styles.flex]}>
                    {chart.map((ch, k) => (
                      <Chip
                        key={ch}
                        label={CHANNELS[ch].label}
                        leading={
                          <Svg width={18} height={6}>
                            <Line
                              x1={0}
                              x2={18}
                              y1={3}
                              y2={3}
                              stroke={color.text}
                              strokeWidth={1.5}
                              strokeDasharray={OVERLAY_DASH[k]}
                            />
                          </Svg>
                        }
                        trailing={<Text tone='textFaint'>×</Text>}
                        onPress={() => onChange(toggleChannel(charts, i, ch))}
                      />
                    ))}
                  </View>
                  <View style={styles.order}>
                    <Button
                      kind='tertiary'
                      label='↑'
                      disabled={i === 0}
                      onPress={() => onChange(moveChart(charts, i, -1))}
                    />
                    <Button
                      kind='tertiary'
                      label='↓'
                      disabled={i === charts.length - 1}
                      onPress={() => onChange(moveChart(charts, i, 1))}
                    />
                    <Button
                      kind='tertiary'
                      label='×'
                      onPress={() => onChange(removeChart(charts, i))}
                    />
                  </View>
                </View>
                {chart.length < MAX_OVERLAY && (
                  <View style={styles.wrap}>
                    {unused(chart).map(ch => (
                      <Chip
                        key={ch}
                        dashed
                        label={`+ ${CHANNELS[ch].label}`}
                        onPress={() => onChange(toggleChannel(charts, i, ch))}
                      />
                    ))}
                  </View>
                )}
              </View>
            ))}
            <View style={styles.wrap}>
              <Text variant='label' tone='textMuted'>
                + Add chart
              </Text>
              {CHANNEL_IDS.map(ch => (
                <Chip
                  key={ch}
                  dashed
                  label={CHANNELS[ch].label}
                  onPress={() => onChange(addChart(charts, ch))}
                />
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {flex: 1},
  sheet: {padding: space.xl, gap: space.md},
  bottom: {
    position: 'absolute',
    top: 120,
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
  side: {position: 'absolute', top: 0, right: 0, bottom: 0},
  header: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  flex: {flex: 1},
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  rows: {gap: space.md, paddingBottom: space.xxxl},
  chartRow: {gap: space.sm, paddingBottom: space.md, borderBottomWidth: 1},
  rowTop: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  order: {flexDirection: 'row'},
});
