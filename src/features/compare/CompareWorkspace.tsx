import {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import Svg, {Path, Rect} from 'react-native-svg';

import {type Field} from '@/src/analysis/field';
import {TraceChart} from '@/src/charts';
import {
  cornerCell,
  formatCornerGap,
  formatDistance,
  radius,
  size,
  space,
  useLayout,
  useTheme,
  disabledOpacity,
} from '@/src/design';
import {
  addChart,
  CHANNEL_IDS,
  clampRightW,
  PLAY_RATES,
  type PlayRate,
  PRESETS,
  RIGHT_W_DEFAULT,
  RIGHT_W_MIN,
  stepWindow,
  toggleChannel,
  useComparePrefs,
} from '@/src/state/comparePrefs';
import {type TraceLoad} from '@/src/data/traces';
import {
  Checkbox,
  Chip,
  PANEL_DIVIDER_W,
  PanelDivider,
  Segment,
  Text,
  TraceRetryBanner,
} from '@/src/ui';

import {BasisSwitch} from './components/BasisSwitch';
import {CarsAround} from './components/CarsAround';
import {NearbyList} from './components/NearbyList';
import {MapPanel} from './components/MapPanel';
import {RefAction} from './components/RefAction';
import {ChartBlock, type LapStyle} from './components/ChartBlock';
import {TrafficLaneBlock} from './components/TrafficLaneBlock';
import {
  CHANNELS,
  type ChartValueRow,
  type CompareModel,
  type CompareSelection,
  drawRank,
  toggleHighlight,
  canRemoveLap,
  removeLap,
  sectionStartM,
  setRef,
  toggleCompared,
  valuesAt,
} from './model';

// The D2 desktop workspace (≥1280, handoff "Desktop"): laps on the left,
// toolbar, whole-lap overview and detail charts in the centre, and the map,
// values table and time per section on the right. Same model and components
// as the phone; this only arranges them.

// Cars around without a radar (iRacing): cars each way.
const NEARBY_WIDE = 5;
const LEFT_W = 260;
// The charts never get narrower than this, whatever the right column asks.
const MIN_CENTRE_W = 480;
// The map is the column's width minus its padding, in D2's 320 : 220 shape.
const MAP_ASPECT = 220 / 320;
const OVERVIEW_H = 58;

export type WorkspaceProps = {
  /** Every car at 5 Hz, once loaded; the radar panel needs it. */
  field?: Field;
  /** A field with no positions (iRacing's): the Cars around list, no radar. */
  listField?: Field;
  /** The session is a race: Cars around shows laps up and down. */
  race: boolean;
  model: CompareModel;
  selection: CompareSelection;
  cursorM: number;
  windowed: boolean;
  windowSizeLabel: string;
  spanLabel: string;
  playing: boolean;
  lapStyle: LapStyle;
  onCursor: (m: number) => void;
  onPan: (dxPt: number, widthPt: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onSelectionChange: (next: CompareSelection) => void;
  onOpenSection: (n: number) => void;
  traceLoad: TraceLoad;
  onRetryTraces: () => void;
};

export function CompareWorkspace(p: WorkspaceProps) {
  const {color} = useTheme();
  const layout = useLayout();
  const prefs = useComparePrefs();
  const [hoverM, setHoverM] = useState<number | null>(null);
  const {model, selection, lapStyle} = p;

  // Centre column minus its padding (D2: 820 column, 780 charts at 1440).
  // The right column's width: while dragging the live value, else the saved
  // one, read through the clamp (a stored width can be stale or hand-edited)
  // and kept from squeezing the charts below MIN_CENTRE_W on a narrow window.
  const [dragW, setDragW] = useState<number | null>(null);
  const maxRightW = Math.max(
    RIGHT_W_MIN,
    layout.width - LEFT_W - MIN_CENTRE_W - PANEL_DIVIDER_W - space.xl * 2,
  );
  const rightW = Math.min(clampRightW(dragW ?? prefs.rightW), maxRightW);
  const mapW = rightW - space.xl * 2;
  const centreW = Math.max(
    MIN_CENTRE_W,
    layout.width - LEFT_W - rightW - PANEL_DIVIDER_W - space.xl * 2,
  );
  const readAt = hoverM ?? p.cursorM;
  const values = valuesAt(model.readouts, model.stepM, readAt);
  const hoverValues =
    hoverM == null
      ? undefined
      : (Object.fromEntries(values.map(r => [r.channel, r.values])) as Record<
          string,
          ChartValueRow['values']
        >);

  return (
    <View style={[styles.root, {backgroundColor: color.bg}]}>
      {/* --- left: laps ------------------------------------------------------ */}
      <ScrollView
        style={[styles.left, {borderColor: color.lineHeader}]}
        contentContainerStyle={styles.col}>
        <Text variant='label' tone='textMuted'>
          Laps
        </Text>
        <BasisSwitch
          selection={selection}
          fastestLapId={model.fastestLapId}
          onSelectionChange={p.onSelectionChange}
        />
        {model.chips.map(c => (
          <View
            key={c.lapId}
            style={[
              styles.lapRow,
              c.isRef && {backgroundColor: color.accentTint},
            ]}>
            {/* The row's own button; Ref and remove sit beside it, never inside. */}
            <Pressable
              accessibilityRole='button'
              accessibilityLabel={`Highlight ${c.label}`}
              onPress={() =>
                p.onSelectionChange(toggleHighlight(selection, c.lapId))
              }
              style={styles.lapMain}>
              <View
                style={[
                  styles.swatch,
                  {backgroundColor: lapStyle(c.selIndex, c.highlighted).color},
                ]}
              />
              <Text variant='dataStrong' style={styles.lapLabel}>
                {c.label}
              </Text>
              <Text
                variant='data'
                tone={c.isRef ? 'textMuted' : c.faster ? 'faster' : 'slower'}
                style={styles.flex}>
                {c.delta}
              </Text>
            </Pressable>
            {!c.isRef && (
              <RefAction
                label={`Set ${c.label} as Ref`}
                onPress={() => p.onSelectionChange(setRef(selection, c.lapId))}
              />
            )}
            {!c.isRef && (
              <Pressable
                accessibilityLabel={`Remove ${c.label}`}
                accessibilityState={{
                  disabled: !canRemoveLap(selection, c.lapId),
                }}
                disabled={!canRemoveLap(selection, c.lapId)}
                hitSlop={space.sm}
                onPress={() =>
                  p.onSelectionChange(removeLap(selection, c.lapId))
                }>
                {/* The last compared lap stays: removing it snaps back to the default. */}
                <Text
                  tone='textFaint'
                  style={
                    selection.laps.length <= 2 ? styles.removeOff : undefined
                  }>
                  ×
                </Text>
              </Pressable>
            )}
          </View>
        ))}
        <Text variant='dataSmall' tone='textFaint'>
          {`Times vs ${model.tableReference.chips}`}
        </Text>
        <Text variant='label' tone='textMuted' style={styles.gapTop}>
          All laps
        </Text>
        {model.allLaps.map(stint => (
          <View key={stint.key} style={styles.stint}>
            <Text variant='dataSmall' tone='textMuted'>
              {stint.label}
            </Text>
            {stint.rows.map(r => (
              <Pressable
                key={r.lapId}
                onPress={() =>
                  p.onSelectionChange(toggleCompared(selection, r.lapId))
                }
                style={[styles.allRow, !r.comparable && styles.dim]}>
                <Checkbox
                  checked={r.selIndex != null}
                  fill={
                    r.selIndex != null
                      ? lapStyle(r.selIndex, r.lapId === selection.hl).color
                      : undefined
                  }
                  onToggle={() =>
                    p.onSelectionChange(toggleCompared(selection, r.lapId))
                  }
                  label={`Compare ${r.label}`}
                />
                <Text variant='dataSmall' style={styles.lapLabel}>
                  {r.label}
                </Text>
                <Text variant='dataSmall' tone='textSecondary'>
                  {r.time}
                </Text>
                <Text
                  variant='dataSmall'
                  tone={r.gapFaster ? 'faster' : 'textMuted'}
                  style={styles.flex}>
                  {r.gap ?? ''}
                </Text>
                {r.tag && (
                  <Text
                    variant='dataSmall'
                    tone={r.tag === 'BEST' ? 'best' : 'textFaint'}>
                    {r.tag}
                  </Text>
                )}
                {!r.isRef && (
                  <RefAction
                    label={`Set ${r.label} as Ref`}
                    onPress={() =>
                      p.onSelectionChange(setRef(selection, r.lapId))
                    }
                  />
                )}
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>

      {/* --- centre: toolbar, overview, detail charts ----------------------- */}
      <View style={[styles.centre, {width: centreW}]}>
        <View
          style={[
            styles.toolbar,
            {backgroundColor: color.surface, borderColor: color.lineHeader},
          ]}>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={p.playing ? 'Pause' : 'Play'}
            onPress={p.onPlay}
            style={[styles.play, {backgroundColor: color.accent}]}>
            <Svg width={12} height={12} viewBox='0 0 14 14'>
              {p.playing ? (
                <>
                  <Rect x={2} y={1} width={3.5} height={12} fill={color.bg} />
                  <Rect x={8.5} y={1} width={3.5} height={12} fill={color.bg} />
                </>
              ) : (
                <Path d='M3 1 L13 7 L3 13 Z' fill={color.bg} />
              )}
            </Svg>
          </Pressable>
          <Segment
            options={PLAY_RATES.map(r => ({value: String(r), label: `${r}×`}))}
            value={String(prefs.rate)}
            onChange={v => prefs.setRate(Number(v) as PlayRate)}
          />
          <Text variant='label' tone='textMuted'>
            Window
          </Text>
          <Segment
            options={[
              {value: 'time', label: 'Time'},
              {value: 'distance', label: 'Distance'},
            ]}
            value={prefs.windowMode}
            onChange={prefs.setWindowMode}
          />
          <Chip
            label='−'
            onPress={() =>
              prefs.setWindowStep(
                stepWindow(prefs.windowMode, prefs.windowStep, -1),
              )
            }
          />
          <Text variant='dataStrong'>{p.windowSizeLabel}</Text>
          <Chip
            label='+'
            onPress={() =>
              prefs.setWindowStep(
                stepWindow(prefs.windowMode, prefs.windowStep, 1),
              )
            }
          />
          <Text variant='dataSmall' tone='textMuted'>
            {p.spanLabel}
          </Text>
          <View style={styles.flex} />
          <Text variant='label' tone='textMuted'>
            Layout
          </Text>
          {PRESETS.map(preset => (
            <Chip
              key={preset.id}
              label={preset.label}
              selected={
                JSON.stringify(preset.charts) === JSON.stringify(prefs.charts)
              }
              onPress={() => prefs.setCharts(preset.charts)}
            />
          ))}
        </View>

        <ScrollView contentContainerStyle={styles.col}>
          {(p.traceLoad.kind === 'failed' ||
            p.traceLoad.kind === 'partial') && (
            <TraceRetryBanner
              failed={p.traceLoad.failed}
              othersShow={p.traceLoad.kind === 'partial'}
              onRetry={p.onRetryTraces}
            />
          )}
          <View style={styles.section}>
            <Text variant='label' tone='textMuted'>
              Whole lap
            </Text>
            <TraceChart
              width={centreW}
              height={OVERVIEW_H}
              stepM={model.stepM}
              windowM={[0, model.lengthM]}
              domain={overviewDomain(model)}
              series={model.overview
                .map(l => {
                  const st = lapStyle(l.selIndex, l.highlighted);
                  return {
                    key: l.lapId,
                    values: l.values,
                    color: st.color,
                    width: st.width,
                    opacity: st.opacity,
                    rank: drawRank(l),
                  };
                })
                .sort((a, b) => a.rank - b.rank)}
              zeroLine
              cursorM={p.cursorM}
              frameM={p.windowed ? model.windowM : undefined}
              marks={(model.map?.sectionApexes ?? []).map(b => ({
                m: b.apexM,
                label: `S${b.n}`,
              }))}
              onScrub={m => {
                p.onPause();
                p.onCursor(m);
              }}
            />
          </View>

          {model.charts.map((c, i) => (
            <ChartBlock
              key={`${i}-${c.key}`}
              chart={c}
              width={centreW}
              height={c.desktopHeight}
              marks={model.apexMarks}
              stepM={model.stepM}
              windowM={model.windowM}
              timeAxis={model.timeAxis}
              cursorM={p.cursorM}
              lapStyle={lapStyle}
              onScrub={p.windowed ? undefined : p.onCursor}
              onPan={p.windowed ? dx => p.onPan(dx, centreW) : undefined}
              onPanStart={p.onPause}
              hoverM={hoverM}
              onHover={setHoverM}
              hoverValues={hoverValues}
              editor={{
                onToggle: ch =>
                  prefs.setCharts(toggleChannel(prefs.charts, i, ch)),
              }}
            />
          ))}
          {model.trafficLane ? (
            <TrafficLaneBlock
              lane={model.trafficLane}
              width={centreW}
              windowM={model.windowM}
              timeAxis={model.timeAxis}
              cursorM={p.cursorM}
              lapStyle={lapStyle}
            />
          ) : null}
          <View style={styles.wrap}>
            <Text variant='label' tone='textMuted'>
              + Add chart
            </Text>
            {CHANNEL_IDS.map(ch => (
              <Chip
                key={ch}
                dashed
                label={CHANNELS[ch].label}
                onPress={() => prefs.setCharts(addChart(prefs.charts, ch))}
              />
            ))}
          </View>
        </ScrollView>
      </View>

      <PanelDivider
        width={rightW}
        onResize={setDragW}
        onCommit={w => {
          prefs.setRightW(w);
          setDragW(null);
        }}
        onReset={() => {
          prefs.setRightW(RIGHT_W_DEFAULT);
          setDragW(null);
        }}
        label='Resize the map and values panel'
      />
      {/* --- right: map, values, time per section ---------------------------- */}
      <ScrollView
        style={[styles.right, {width: rightW, borderColor: color.lineHeader}]}
        contentContainerStyle={styles.col}>
        {model.map && (
          <MapPanel
            zoomControls
            width={mapW}
            height={Math.round(mapW * MAP_ASPECT)}
            map={model.map}
            openSection={selection.corner ?? null}
            lapStyle={lapStyle}
            onPressSection={p.onOpenSection}
          />
        )}
        {p.field && model.radarLap && (
          <CarsAround
            field={p.field}
            lapNumber={model.radarLap.lapNumber}
            lapLabel={model.radarLap.label}
            cursorM={p.cursorM}
          />
        )}
        {p.listField && model.radarLap && (
          <NearbyList
            field={p.listField}
            lapNumber={model.radarLap.lapNumber}
            lapLabel={model.radarLap.label}
            cursorM={p.cursorM}
            perSide={NEARBY_WIDE}
            race={p.race}
          />
        )}
        <View style={styles.section}>
          <Text variant='label' tone='textMuted'>
            {hoverM != null ? 'Hover' : 'Cursor'} · {formatDistance(readAt)}
          </Text>
          <View style={styles.table}>
            {values.map(row => (
              <View key={row.channel} style={styles.tableRow}>
                <Text
                  variant='dataSmall'
                  tone='textMuted'
                  style={styles.tableHead}>
                  {row.label}
                  {row.unit ? ` ${row.unit}` : ''}
                </Text>
                {row.values.map(v => (
                  <Text
                    key={v.lapId}
                    variant='dataStrong'
                    style={[
                      styles.tableCell,
                      {color: lapStyle(v.selIndex, v.highlighted).color},
                    ]}>
                    {v.text}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </View>
        {model.grid && (
          <View style={styles.section}>
            <Text variant='label' tone='textMuted'>
              {`Time per section vs ${model.tableReference.grid}`}
            </Text>
            <View style={styles.tableRow}>
              <View style={styles.sectionHead} />
              {model.grid.rows.map(r => (
                <Text
                  key={r.key}
                  variant='dataSmall'
                  style={[
                    styles.gridCell,
                    r.selIndex != null && {
                      color: lapStyle(r.selIndex, r.lapId === selection.hl)
                        .color,
                    },
                  ]}>
                  {r.label}
                </Text>
              ))}
            </View>
            {model.grid.corners.map((n, i) => (
              <Pressable
                key={n}
                onPress={() => p.onOpenSection(n)}
                style={[
                  styles.tableRow,
                  n === selection.corner && {backgroundColor: color.accentTint},
                ]}>
                {/* One tap on the label moves playback to the section's start (D28). */}
                <Pressable
                  accessibilityRole='button'
                  accessibilityLabel={`Jump to S${n}`}
                  hitSlop={8}
                  onPress={() =>
                    p.onCursor(sectionStartM(model.sectionEntryM, n))
                  }
                  style={styles.sectionHead}>
                  <Text variant='dataSmall' tone='textMuted'>
                    S{n} · {formatDistance(model.sectionEntryM[n] ?? 0)}
                  </Text>
                </Pressable>
                {model.grid!.rows.map(r => {
                  const d = r.cells[i];
                  const c = d == null ? null : cornerCell(d);
                  return (
                    <View
                      key={r.key}
                      style={[
                        styles.gridCell,
                        styles.cell,
                        {backgroundColor: c?.bg ?? color.surfaceRaised},
                      ]}>
                      <Text
                        variant='dataSmall'
                        style={{color: c?.fg ?? color.textFaint}}>
                        {d == null ? '—' : formatCornerGap(d)}
                      </Text>
                    </View>
                  );
                })}
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function overviewDomain(model: CompareModel): [number, number] {
  let m = 0.1;
  for (const l of model.overview)
    for (const v of l.values) m = Math.max(m, Math.abs(v));
  return [-m, m];
}

const styles = StyleSheet.create({
  removeOff: {opacity: disabledOpacity},
  root: {flex: 1, flexDirection: 'row'},
  flex: {flex: 1},
  col: {gap: space.md, padding: space.xl, paddingBottom: space.xxxl},
  left: {width: LEFT_W, flexGrow: 0, borderRightWidth: 1},
  right: {flexGrow: 0},
  centre: {flex: 1},
  gapTop: {marginTop: space.lg},
  lapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: size.lapRow,
    paddingHorizontal: space.xs,
    borderRadius: radius.sm,
  },
  // The row's button: swatch, label and delta, taking what Ref and remove leave.
  lapMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: '100%',
  },
  swatch: {width: 10, height: 3},
  lapLabel: {width: 34},
  stint: {gap: space.xxs},
  allRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 26,
  },
  dim: {opacity: 0.5},
  // One row at 1440, as D2 draws it; wraps rather than clips nearer 1280.
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.xs,
    padding: space.md,
    borderBottomWidth: 1,
  },
  play: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {gap: space.xs},
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  mapBox: {
    borderRadius: radius.md,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  table: {gap: space.xxs},
  tableRow: {flexDirection: 'row', alignItems: 'center', gap: space.xs},
  tableHead: {width: 110},
  tableCell: {width: 64, textAlign: 'right'},
  sectionHead: {width: 110},
  gridCell: {width: 52, textAlign: 'center'},
  cell: {
    height: 24,
    borderRadius: radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
