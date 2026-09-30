import {useRouter} from 'expo-router';
import {
  type Dispatch,
  type SetStateAction,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Svg, {Line} from 'react-native-svg';

import {panCursor} from '@/src/analysis/window';
import {CornerGrid, TrackStrip} from '@/src/charts';
import {useField} from '@/src/data/field';
import {useSession} from '@/src/data/sessions';
import {lapStroke, space, useLayout, useTheme} from '@/src/design';
import {cornerHref, sessionHref} from '@/src/nav/routes';
import {
  CHANNEL_IDS,
  MAX_OVERLAY,
  stepWindow,
  toggleChannel,
  useComparePrefs,
  windowSize,
} from '@/src/state/comparePrefs';
import {type TraceLoad} from '@/src/data/traces';
import {
  Button,
  Chip,
  Explainer,
  Segment,
  Skeleton,
  StatusBanner,
  Text,
  TraceRetryBanner,
} from '@/src/ui';

import {MapPanel} from './components/MapPanel';
import {ChartBlock, type LapStyle} from './components/ChartBlock';
import {RADAR_DOCK_W, RadarDock} from './components/RadarDock';
import {ChartEditor} from './components/ChartEditor';
import {TransportBar} from './components/TransportBar';
import {
  CHANNELS,
  type CompareModel,
  type CompareSelection,
  makeReference,
  removeLap,
} from './model';
import {type PlayInputs, playTicker} from './playback';
import {useCompareModel} from './useCompareModel';
import {CompareWorkspace} from './CompareWorkspace';

export type {CompareSelection} from './model';

// Handoff v2 M1 frames: the map area is 220 pt tall on the phone too.
const MAP_H = 220;
const DESKTOP_SIDE_W = 360;
const DESKTOP_MAP_H = 220;
// Traces are the point on desktop (livery's spec, thread 24 #254).
const DESKTOP_CHART_SCALE = 1.4;
const ONE_CHART_H = 330;
// Keyboard: ←/→ step the cursor 5 m, Shift 50 m.
const KEY_STEP_M = 5;
const KEY_STEP_SHIFT_M = 50;
const CURSOR_SETTLE_MS = 400;

export function CompareScreen({
  sessionId,
  selection,
  onSelectionChange,
}: {
  sessionId: string;
  selection: CompareSelection;
  onSelectionChange: (next: CompareSelection) => void;
}) {
  // The cursor moves on every drag and playback frame, so it lives here,
  // not in the URL.
  const [cursorM, setCursorM] = useState(selection.cursorM);
  const prefs = useComparePrefs();
  const size = windowSize(prefs.windowMode, prefs.windowStep);
  const result = useCompareModel(
    sessionId,
    {...selection, cursorM},
    prefs.charts,
    {mode: prefs.windowMode, size},
  );
  const {color} = useTheme();
  const insets = useSafeAreaInsets();

  if (result.state !== 'ready')
    return (
      <View
        style={[
          styles.screen,
          styles.center,
          {backgroundColor: color.bg, paddingTop: insets.top},
        ]}>
        {result.state === 'loading' ? (
          <ActivityIndicator color={color.accent} />
        ) : (
          <View style={styles.banner}>
            <StatusBanner
              dot='idle'
              text={`Couldn’t load this session: ${result.message}`}
              actionLabel='Retry'
              onAction={result.retry}
            />
          </View>
        )}
      </View>
    );
  return (
    <CompareView
      sessionId={sessionId}
      model={result.model}
      traceLoad={result.traceLoad}
      onRetryTraces={result.retryTraces}
      selection={selection}
      cursorM={cursorM}
      windowSizeValue={size}
      onCursor={setCursorM}
      onSelectionChange={onSelectionChange}
    />
  );
}

function CompareView({
  sessionId,
  model,
  traceLoad,
  onRetryTraces,
  selection,
  cursorM,
  windowSizeValue,
  onCursor,
  onSelectionChange,
}: {
  sessionId: string;
  model: CompareModel;
  traceLoad: TraceLoad;
  onRetryTraces: () => void;
  selection: CompareSelection;
  cursorM: number;
  /** Seconds or metres; null = whole lap. */
  windowSizeValue: number | null;
  /** Takes an updater too, so steps in the same tick build on each other. */
  onCursor: Dispatch<SetStateAction<number>>;
  onSelectionChange: (next: CompareSelection) => void;
}) {
  const {color, scheme} = useTheme();
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const prefs = useComparePrefs();
  // The field of every car (round 3): loads after the traces, never blocks them.
  const session = useSession(sessionId);
  const field = useField(sessionId, session.data?.field?.hash ?? null).data;
  const [editing, setEditing] = useState(false);
  // Phone, One chart view: chart tabs, overlay pills and the explainer sit
  // behind the Charts row until opened (round 3, pit-wall thread 27 #766).
  const [chartsOpen, setChartsOpen] = useState(false);
  const [playing, setPlaying] = useState(false);

  const count = selection.laps.length;
  const lapStyle: LapStyle = useCallback(
    (selIndex, highlighted) => lapStroke(scheme, selIndex, count, highlighted),
    [scheme, count],
  );
  // Compare works per section; Corner opens the section's first corner.
  const openCorner = (section: number) =>
    router.push(
      cornerHref(sessionId, model.sectionFirstCorner[section] ?? section, {
        laps: selection.laps,
        hl: selection.hl,
      }),
    );

  // --- cursor movement: pan, keyboard, playback ---------------------------------
  const ref = model.refGrid;
  const windowed = windowSizeValue != null && ref != null;
  const pan = (dxPt: number, widthPt: number) => {
    if (!ref || windowSizeValue == null) return;
    onCursor(
      panCursor(ref, cursorM, prefs.windowMode, windowSizeValue, dxPt, widthPt),
    );
  };
  const moveBy = (dm: number) =>
    onCursor(c => Math.max(0, Math.min(model.lengthM, c + dm)));

  // Playback: advance by wall-clock time on the reference lap, looping
  // (features/compare/playback.ts).
  const live = useRef<PlayInputs>({ref, rate: prefs.rate, move: onCursor});
  useEffect(() => {
    live.current = {ref, rate: prefs.rate, move: onCursor};
  });
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const step = playTicker(
      () => live.current,
      () => performance.now(),
    );
    const tick = () => {
      step();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // The URL keeps the cursor for links and reloads. Writing it on every
  // frame would flood navigation, so write once it settles: after a pause,
  // a drag, a scrub or a key step (apex's #38 follow-up).
  const settled = useRef({selection, onSelectionChange});
  useEffect(() => {
    settled.current = {selection, onSelectionChange};
  });
  useEffect(() => {
    if (playing) return;
    const timer = setTimeout(() => {
      const {selection: sel, onSelectionChange: write} = settled.current;
      if (Math.round(sel.cursorM) !== Math.round(cursorM))
        write({...sel, cursorM});
    }, CURSOR_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [cursorM, playing]);

  // Keyboard on web: ←/→ step, Shift for bigger steps, space plays, [ ] window.
  const keys = useRef({moveBy, setPlaying});
  useEffect(() => {
    keys.current = {moveBy, setPlaying};
  });
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      if (e.target instanceof HTMLInputElement) return;
      const step = e.shiftKey ? KEY_STEP_SHIFT_M : KEY_STEP_M;
      if (e.key === 'ArrowRight') k.moveBy(step);
      else if (e.key === 'ArrowLeft') k.moveBy(-step);
      else if (e.key === ' ') k.setPlaying(p => !p);
      else if (e.key === '[' || e.key === ']') {
        // Read the store, not the render's copy: two presses in one tick
        // must both step.
        const p = useComparePrefs.getState();
        p.setWindowStep(
          stepWindow(p.windowMode, p.windowStep, e.key === '[' ? -1 : 1),
        );
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- layout -------------------------------------------------------------------
  const sideW = layout.isDesktop ? DESKTOP_SIDE_W : layout.contentWidth;
  const mainW = layout.isDesktop
    ? layout.contentWidth - DESKTOP_SIDE_W - space.xxl
    : layout.contentWidth;
  const oneChart = prefs.view === 'one' && !layout.isDesktop;
  const mapShown = layout.isDesktop || prefs.mapShown;

  const header = (
    <View style={styles.header}>
      <Pressable
        accessibilityRole='link'
        hitSlop={space.md}
        onPress={() =>
          router.navigate(sessionHref(sessionId, {laps: selection.laps}))
        }>
        <Text variant='bodyStrong' tone='accentInk'>
          ‹ Session
        </Text>
      </Pressable>
      <Text variant='display' style={styles.flex}>
        Compare
      </Text>
      {!layout.isDesktop && (
        <Pressable
          accessibilityRole='button'
          hitSlop={space.md}
          onPress={() => prefs.setMapShown(!prefs.mapShown)}>
          <Text variant='dataStrong' tone='accentInk'>
            {prefs.mapShown ? 'Hide map' : 'Show map'}
          </Text>
        </Pressable>
      )}
    </View>
  );

  const reference = (
    <View style={styles.refRow}>
      <Text variant='label' tone='textMuted'>
        Reference
      </Text>
      <Svg width={14} height={4}>
        <Line
          x1={0}
          x2={14}
          y1={2}
          y2={2}
          stroke={lapStyle(0, false).color}
          strokeWidth={2.3}
        />
      </Svg>
      <Text variant='dataStrong' numberOfLines={1} style={styles.flex}>
        {model.reference}
      </Text>
    </View>
  );

  const chipItems = (
    <>
      {model.chips.map(c => (
        <Chip
          key={c.lapId}
          label={c.label}
          selected={c.isRef}
          onPress={() => onSelectionChange(makeReference(selection, c.lapId))}
          leading={
            <View
              style={[
                styles.swatch,
                {backgroundColor: lapStyle(c.selIndex, c.highlighted).color},
              ]}
            />
          }
          trailing={
            <>
              <Text
                variant='dataSmall'
                tone={c.isRef ? 'textMuted' : c.faster ? 'faster' : 'slower'}>
                {c.delta}
              </Text>
              {!c.isRef && (
                <Pressable
                  accessibilityLabel={`Remove ${c.label}`}
                  hitSlop={space.md}
                  onPress={() =>
                    onSelectionChange(removeLap(selection, c.lapId))
                  }>
                  <Text variant='dataSmall' tone='textFaint'>
                    ×
                  </Text>
                </Pressable>
              )}
            </>
          }
        />
      ))}
      {model.manyChip && <Chip label={model.manyChip} dashed />}
      {model.notFound > 0 && (
        <Chip
          label={`${model.notFound} lap${
            model.notFound > 1 ? 's' : ''
          } not found`}
          dashed
        />
      )}
    </>
  );
  const chips = layout.isDesktop ? (
    <View style={styles.chipsWrap}>{chipItems}</View>
  ) : (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipsRow}>
      {chipItems}
    </ScrollView>
  );

  const map =
    model.map &&
    (mapShown ? (
      <MapPanel
        width={sideW}
        height={layout.isDesktop ? DESKTOP_MAP_H : MAP_H}
        map={model.map}
        sessionId={sessionId}
        openSection={selection.corner ?? null}
        lapStyle={lapStyle}
        onPressSection={openCorner}
      />
    ) : (
      <TrackStrip
        width={sideW}
        lengthM={model.lengthM}
        corners={model.map.sectionApexes.map(b => ({n: b.n, m: b.apexM}))}
        windowM={model.windowM}
        markers={model.map.dots.map(d => ({
          key: d.lapId,
          m: cursorM,
          color: lapStyle(d.selIndex, d.highlighted).color,
        }))}
        onScrub={onCursor}
      />
    ));

  const position = (
    <View style={styles.positionRow}>
      <Text variant='dataStrong'>{model.position.place}</Text>
      <Text variant='dataSmall' tone='textMuted'>
        {model.position.distance}
      </Text>
      <View style={styles.values}>
        {model.position.speeds.map(s => (
          <Text
            key={s.lapId}
            variant='dataStrong'
            style={{color: lapStyle(s.selIndex, s.highlighted).color}}>
            {s.text}
          </Text>
        ))}
        <Text variant='dataSmall' tone='textFaint'>
          km/h
        </Text>
      </View>
    </View>
  );

  const grid = model.grid && !oneChart && (
    <Section title='Time per section' explainer={model.grid.explainer}>
      <CornerGrid
        width={sideW}
        corners={model.grid.corners}
        rows={model.grid.rows.map(r => ({
          key: r.key,
          label: r.label,
          cells: r.cells,
          color:
            r.selIndex == null
              ? undefined
              : lapStyle(r.selIndex, r.lapId === selection.hl).color,
        }))}
        openCorner={selection.corner}
        onPressCorner={openCorner}
      />
    </Section>
  );

  const chartProps = (h: number) => ({
    width: mainW,
    height: Math.round(h),
    marks: model.apexMarks,
    stepM: model.stepM,
    windowM: model.windowM,
    timeAxis: model.timeAxis,
    cursorM,
    lapStyle,
    onScrub: windowed ? undefined : onCursor,
    onPan: windowed ? (dx: number) => pan(dx, mainW) : undefined,
    onPanStart: () => setPlaying(false),
  });
  const heightScale = layout.isDesktop ? DESKTOP_CHART_SCALE : 1;
  const focused = Math.min(prefs.focused, model.charts.length - 1);
  const focusedChart = model.charts[focused];

  const chartsBar = (
    <View
      style={[
        styles.chartsBar,
        {backgroundColor: color.surface, borderColor: color.lineHeader},
      ]}>
      {layout.isDesktop || !oneChart ? (
        <Text variant='label' tone='textMuted'>
          Charts
        </Text>
      ) : (
        <Pressable
          accessibilityRole='button'
          accessibilityState={{expanded: chartsOpen}}
          hitSlop={space.md}
          onPress={() => setChartsOpen(o => !o)}>
          <Text variant='label' tone='textMuted'>
            {chartsOpen ? 'Charts ▾' : 'Charts ▸'}
          </Text>
        </Pressable>
      )}
      {!layout.isDesktop && (
        <Segment
          options={[
            {value: 'stack', label: 'Stack'},
            {value: 'one', label: 'One chart'},
          ]}
          value={prefs.view}
          onChange={prefs.setView}
        />
      )}
      <View style={styles.flex} />
      {model.pending > 0 && (
        <Text variant='dataSmall' tone='textFaint'>
          loading {model.pending}…
        </Text>
      )}
      <Button
        kind='tertiary'
        label='Edit charts'
        onPress={() => setEditing(true)}
      />
    </View>
  );

  const oneChartTabs = oneChart && chartsOpen && focusedChart && (
    <View style={styles.oneTabs}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.chipsRow}>
          {model.charts.map((c, i) => (
            <Chip
              key={c.key}
              label={c.title}
              selected={i === focused}
              onPress={() => prefs.setFocused(i)}
            />
          ))}
        </View>
      </ScrollView>
      <Text variant='explainer' tone='textMuted'>
        Overlay on this chart (up to {MAX_OVERLAY}):
      </Text>
      <View style={styles.chipsWrap}>
        {CHANNEL_IDS.map(ch => {
          const on = focusedChart.channels.includes(ch);
          const full = focusedChart.channels.length >= MAX_OVERLAY;
          const last = on && focusedChart.channels.length === 1;
          return (
            <Chip
              key={ch}
              label={`${on ? '✓' : '+'} ${CHANNELS[ch].label}`}
              selected={on}
              onPress={() => {
                if (last || (!on && full)) return;
                prefs.setCharts(toggleChannel(prefs.charts, focused, ch));
              }}
            />
          );
        })}
      </View>
    </View>
  );

  // No trace yet: the chart frames at their real heights, so nothing moves
  // when the lines arrive (round 3 R4c).
  const noTraces = traceLoad.kind === 'loading' || traceLoad.kind === 'failed';
  const skeletons = (oneChart ? [focusedChart] : model.charts).map(
    c =>
      c && (
        <View key={c.key} style={styles.skeleton}>
          <Text variant='label' tone='textMuted'>
            {c.title}
          </Text>
          <Skeleton
            height={Math.round(oneChart ? ONE_CHART_H : c.height * heightScale)}
          />
        </View>
      ),
  );
  // Phone: the radar docks beside the speed chart, or beside the one chart
  // shown (R2b). The lap it follows is the playing one; without field data
  // for that lap the chart keeps the full width.
  const dockLap = model.playing?.lapNumber ?? null;
  const dockOn = !layout.isDesktop && field != null && dockLap != null;
  const dockedChart = (c: (typeof model.charts)[number], h: number) => {
    const docked = dockOn && (oneChart || c.channels.includes('speed'));
    const chartW = mainW - RADAR_DOCK_W - space.md;
    return docked ? (
      <View key={c.key} style={styles.docked}>
        {/* Fixed width: the explainer's long line must wrap, not push the radar out. */}
        <View style={{width: chartW}}>
          <ChartBlock chart={c} {...chartProps(h)} width={chartW} />
        </View>
        <RadarDock field={field} lapNumber={dockLap} cursorM={cursorM} />
      </View>
    ) : (
      <ChartBlock key={c.key} chart={c} {...chartProps(h)} />
    );
  };
  const chartList = noTraces
    ? skeletons
    : oneChart
    ? focusedChart && dockedChart(focusedChart, ONE_CHART_H)
    : model.charts.map(c => dockedChart(c, c.height * heightScale));

  const spanLabel =
    windowSizeValue == null
      ? 'whole lap'
      : prefs.windowMode === 'distance'
      ? 'fixed'
      : `≈ ${Math.round(model.windowM[1] - model.windowM[0])} m`;
  const transport = (
    <TransportBar
      oneRow={layout.isDesktop}
      mode={prefs.windowMode}
      step={prefs.windowStep}
      sizeLabel={
        windowSizeValue == null
          ? 'Lap'
          : `${windowSizeValue} ${prefs.windowMode === 'time' ? 's' : 'm'}`
      }
      spanLabel={spanLabel}
      playing={playing}
      rate={prefs.rate}
      onMode={prefs.setWindowMode}
      onStep={dir =>
        prefs.setWindowStep(stepWindow(prefs.windowMode, prefs.windowStep, dir))
      }
      onPlay={() => setPlaying(p => !p)}
      onRate={prefs.setRate}
    />
  );

  const charts = (
    <View style={styles.charts}>
      {chartsBar}
      {oneChartTabs}
      {(traceLoad.kind === 'failed' || traceLoad.kind === 'partial') && (
        <TraceRetryBanner
          failed={traceLoad.failed}
          othersShow={traceLoad.kind === 'partial'}
          onRetry={onRetryTraces}
        />
      )}
      {(!oneChart || chartsOpen) && (
        <Explainer>
          {windowed
            ? 'Charts show a short window around the cursor. Drag any chart to move through the lap, or press play. Change the window size below. Lines join the recorded samples; their positions come from integrated speed.'
            : 'Drag any chart to move through the lap. The cursor, map dots and values follow it.'}
        </Explainer>
      )}
      {chartList}
    </View>
  );

  const editor = (
    <ChartEditor
      visible={editing}
      charts={prefs.charts}
      onChange={prefs.setCharts}
      onClose={() => setEditing(false)}
    />
  );

  if (layout.isWide)
    return (
      <CompareWorkspace
        sessionId={sessionId}
        model={model}
        selection={selection}
        cursorM={cursorM}
        windowed={windowed}
        windowSizeLabel={
          windowSizeValue == null
            ? 'Lap'
            : `${windowSizeValue} ${prefs.windowMode === 'time' ? 's' : 'm'}`
        }
        spanLabel={spanLabel}
        playing={playing}
        lapStyle={lapStyle}
        onCursor={onCursor}
        onPan={pan}
        onPlay={() => setPlaying(p => !p)}
        onPause={() => setPlaying(false)}
        onSelectionChange={onSelectionChange}
        onOpenSection={openCorner}
        traceLoad={traceLoad}
        onRetryTraces={onRetryTraces}
      />
    );

  const top = {paddingTop: insets.top + space.lg};
  if (layout.isDesktop)
    return (
      <View style={[styles.screen, top, {backgroundColor: color.bg}]}>
        <View style={[styles.desktop, {width: layout.contentWidth}]}>
          <ScrollView style={{width: sideW}} contentContainerStyle={styles.col}>
            {header}
            {reference}
            {chips}
            {map}
            {position}
            {grid}
          </ScrollView>
          <View style={{width: mainW}}>
            <ScrollView contentContainerStyle={styles.col}>{charts}</ScrollView>
            {transport}
          </View>
        </View>
        {editor}
      </View>
    );
  return (
    <View style={[styles.screen, {backgroundColor: color.bg}]}>
      <ScrollView
        contentContainerStyle={[
          styles.col,
          top,
          {width: layout.contentWidth, alignSelf: 'center'},
        ]}>
        {header}
        {reference}
        {chips}
        {map}
        {position}
        {grid}
        {charts}
      </ScrollView>
      <View style={{paddingBottom: insets.bottom}}>{transport}</View>
      {editor}
    </View>
  );
}

function Section({
  title,
  explainer,
  children,
}: {
  title: string;
  explainer: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text variant='label' tone='textMuted'>
        {title}
      </Text>
      <Explainer>{explainer}</Explainer>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  center: {alignItems: 'center', justifyContent: 'center'},
  flex: {flex: 1},
  col: {gap: space.md, paddingBottom: space.xxxl},
  desktop: {flex: 1, flexDirection: 'row', gap: space.xxl, alignSelf: 'center'},
  header: {flexDirection: 'row', alignItems: 'center', gap: space.lg},
  refRow: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  chipsRow: {flexDirection: 'row', gap: space.sm, paddingVertical: space.xs},
  chipsWrap: {flexDirection: 'row', flexWrap: 'wrap', gap: space.sm},
  swatch: {width: 10, height: 3},
  positionRow: {flexDirection: 'row', alignItems: 'baseline', gap: space.sm},
  values: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.md,
  },
  section: {gap: space.xs, marginTop: space.sm},
  charts: {gap: space.lg, marginTop: space.sm},
  skeleton: {gap: space.xs},
  banner: {alignSelf: 'stretch', paddingHorizontal: space.xl},
  chartsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    height: 36,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  oneTabs: {gap: space.xs},
  docked: {flexDirection: 'row', gap: space.md},
});
