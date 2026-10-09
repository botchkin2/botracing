import {useRouter} from 'expo-router';
import {
  type Dispatch,
  type SetStateAction,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
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
import {
  type DefaultSession,
  useSession,
  useSessionLaps,
} from '@/src/data/sessions';
import {
  disabledOpacity,
  hitBox,
  lapStroke,
  space,
  useLayout,
  useTheme,
} from '@/src/design';
import {SessionNav} from '@/src/workspace/SessionNav';
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
  hitFor,
  Segment,
  Skeleton,
  StatusBanner,
  Text,
  TraceRetryBanner,
} from '@/src/ui';

import {BasisSwitch} from './components/BasisSwitch';
import {MapPanel} from './components/MapPanel';
import {ChartBlock, type LapStyle} from './components/ChartBlock';
import {RadarOverlay} from './components/RadarOverlay';
import {TrafficLaneBlock} from './components/TrafficLaneBlock';
import {ChartEditor} from './components/ChartEditor';
import {TransportBar} from './components/TransportBar';
import {
  CHANNELS,
  type CompareModel,
  type CompareSelection,
  setRef,
  toggleHighlight,
  canRemoveLap,
  removeLap,
  withDefaultLaps,
} from './model';
import {type PlayInputs, playTicker} from './playback';
import {useAutoHide} from './useAutoHide';
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
const TRANSPORT_IDLE_MS = 3000;
// The chip's right 44 pt removes the lap (apex, thread 27 #867): the glyph is
// ~8 wide with the chip's 8 pt padding on the right, so the rest grows left.
const removeHit = hitFor({left: 14, right: space.md}, 15);
// The "Ref" beside it: the chip's tap makes the reference too, but nothing said
// so (Botkin, thread 43 #1267); this says it. 14 pt either side keeps the two
// targets from overlapping.
const refHit = hitFor({left: 14, right: 14}, 15);
// Keyboard: ←/→ step the cursor 5 m, Shift 50 m.
const KEY_STEP_M = 5;
const KEY_STEP_SHIFT_M = 50;
const CURSOR_SETTLE_MS = 400;

export function CompareScreen({
  sessionId,
  selection: urlSelection,
  onSelectionChange,
}: {
  sessionId: string;
  selection: CompareSelection;
  onSelectionChange: (next: CompareSelection) => void;
}) {
  // A URL with no laps opens on a fair reference and the median lap.
  const sessionDoc = useSession(sessionId);
  const sessionLaps = useSessionLaps(sessionId);
  const sessionFacts = useMemo<DefaultSession | undefined>(
    () =>
      sessionDoc.data && {
        id: sessionDoc.data.id,
        bestLapId: sessionDoc.data.bestLapId,
        car: sessionDoc.data.car,
        sessionType: sessionDoc.data.sessionType,
      },
    [sessionDoc.data],
  );
  const selection = useMemo(
    () => withDefaultLaps(urlSelection, sessionLaps.data, sessionFacts),
    [urlSelection, sessionLaps.data, sessionFacts],
  );
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
  // Phone, One chart view: chart tabs and overlay pills sit
  // behind the Charts row until opened (round 3, pit-wall thread 27 #766).
  const [chartsOpen, setChartsOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  // Phone: the window and step controls fade after a few seconds with no touch
  // on the charts; Play stays. They keep their space, so nothing reflows (#44).
  const seek = useAutoHide(TRANSPORT_IDLE_MS, playing);

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

  const headerRow = (
    <View style={styles.header}>
      <Pressable
        accessibilityRole='link'
        style={hitBox.link}
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
          style={hitBox.link}
          hitSlop={space.md}
          onPress={() => prefs.setMapShown(!prefs.mapShown)}>
          <Text variant='dataStrong' tone='accentInk'>
            {prefs.mapShown ? 'Hide map' : 'Show map'}
          </Text>
        </Pressable>
      )}
    </View>
  );

  const header = layout.isDesktop ? (
    headerRow
  ) : (
    <View>
      {headerRow}
      <SessionNav sessionId={sessionId} />
    </View>
  );

  const refChip = model.chips.find(c => c.isRef);
  const reference = (
    <View style={styles.refRow}>
      <Text variant='label' tone='textMuted'>
        Vs
      </Text>
      <BasisSwitch
        selection={selection}
        fastestLapId={model.fastestLapId}
        onSelectionChange={onSelectionChange}
      />
      {refChip && (
        <Svg width={14} height={4}>
          <Line
            x1={0}
            x2={14}
            y1={2}
            y2={2}
            stroke={lapStyle(refChip.selIndex, false).color}
            strokeWidth={2.3}
          />
        </Svg>
      )}
      <Text variant='dataStrong' numberOfLines={1} style={styles.flex}>
        {model.reference}
      </Text>
    </View>
  );
  const referenceHint = (
    <Text variant='dataSmall' tone='textFaint'>
      {`Times vs ${model.tableReference.chips}`}
    </Text>
  );

  const chipItems = (
    <>
      {model.chips.map(c => (
        <Chip
          key={c.lapId}
          label={c.label}
          selected={c.isRef}
          onPress={() => onSelectionChange(toggleHighlight(selection, c.lapId))}
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
            </>
          }
          actions={
            !c.isRef ? (
              <>
                {/* Only the tapped chip offers it: "Ref" on every chip read as if every lap were the Ref. */}
                {c.highlighted && (
                  <Pressable
                    accessibilityRole='button'
                    accessibilityLabel={`Set ${c.label} as Ref`}
                    {...refHit}
                    onPress={() =>
                      onSelectionChange(setRef(selection, c.lapId))
                    }>
                    <Text variant='dataSmall' tone='accentInk'>
                      Set ref
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityLabel={`Remove ${c.label}`}
                  accessibilityState={{
                    disabled: !canRemoveLap(selection, c.lapId),
                  }}
                  disabled={!canRemoveLap(selection, c.lapId)}
                  {...removeHit}
                  onPress={() =>
                    onSelectionChange(removeLap(selection, c.lapId))
                  }>
                  <Text
                    variant='dataSmall'
                    tone='textFaint'
                    style={
                      canRemoveLap(selection, c.lapId)
                        ? undefined
                        : styles.removeOff
                    }>
                    ×
                  </Text>
                </Pressable>
              </>
            ) : undefined
          }
        />
      ))}
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

  // Phone: the radar is on the Follow map while a car is in range; without
  // field data for the playing lap there is none.
  const dockLap = model.playing?.lapNumber ?? null;
  const radarOn = !layout.isDesktop && field != null && dockLap != null;
  const map =
    model.map &&
    (mapShown ? (
      <MapPanel
        width={sideW}
        height={layout.isDesktop ? DESKTOP_MAP_H : MAP_H}
        map={model.map}
        openSection={selection.corner ?? null}
        lapStyle={lapStyle}
        onPressSection={openCorner}
        zoomControls
        radar={
          radarOn && field != null && dockLap != null ? (
            <RadarOverlay field={field} lapNumber={dockLap} cursorM={cursorM} />
          ) : undefined
        }
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
    </View>
  );

  const grid = model.grid && !oneChart && (
    <Section title={`Time per section vs ${model.tableReference.grid}`}>
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
          style={hitBox.link}
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
      <Text variant='label' tone='textMuted'>
        Overlay
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
  // The last chart keeps its values above the plot (the chart
  // header), so nothing sits between the plot and the Follow map under it
  // (round 5, item 6); the others are plot first, numbers below (thread 41
  // #1178).
  const phoneChart = (
    c: (typeof model.charts)[number],
    h: number,
    last: boolean,
  ) => {
    return (
      <ChartBlock
        key={c.key}
        chart={c}
        {...chartProps(h)}
        plotFirst={!layout.isDesktop && !last}
      />
    );
  };
  const chartList = noTraces
    ? skeletons
    : oneChart
    ? focusedChart && phoneChart(focusedChart, ONE_CHART_H, true)
    : model.charts.map((c, i) =>
        phoneChart(c, c.height * heightScale, i === model.charts.length - 1),
      );

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
      seekVisible={layout.isDesktop || seek.visible}
      rate={prefs.rate}
      onMode={prefs.setWindowMode}
      onStep={dir =>
        prefs.setWindowStep(stepWindow(prefs.windowMode, prefs.windowStep, dir))
      }
      onPlay={() => {
        setPlaying(p => !p);
      }}
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
      {chartList}
      {!noTraces && model.trafficLane && (!oneChart || chartsOpen) ? (
        <TrafficLaneBlock
          lane={model.trafficLane}
          width={mainW}
          windowM={model.windowM}
          timeAxis={model.timeAxis}
          cursorM={cursorM}
          lapStyle={lapStyle}
        />
      ) : null}
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
        field={field}
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
            {referenceHint}
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
        {referenceHint}
        {chips}
        {/* The plot ends and the Follow map starts on the next pixel, so the
            eye moves from the trace to the car without crossing anything
            (round 5, item 6). */}
        <View style={styles.plotMap}>
          <View
            onStartShouldSetResponderCapture={() => {
              seek.reveal();
              return false;
            }}>
            {charts}
          </View>
          {map}
        </View>
        {position}
        {grid}
      </ScrollView>
      <View style={{paddingBottom: insets.bottom}}>{transport}</View>
      {editor}
    </View>
  );
}

function Section({title, children}: {title: string; children: ReactNode}) {
  return (
    <View style={styles.section}>
      <Text variant='label' tone='textMuted'>
        {title}
      </Text>
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
  // Vertical padding = the chips' 8 pt hit growth, or the scroll view clips it.
  removeOff: {opacity: disabledOpacity},
  chipsRow: {flexDirection: 'row', gap: space.sm, paddingVertical: space.md},
  // Row gap 2 x the chips' 8 pt vertical hit growth, so wrapped rows never overlap.
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space.sm,
    rowGap: space.xl,
  },
  swatch: {width: 10, height: 3},
  positionRow: {flexDirection: 'row', alignItems: 'baseline', gap: space.sm},
  section: {gap: space.xs, marginTop: space.sm},
  charts: {gap: space.lg, marginTop: space.sm},
  plotMap: {gap: 0},
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
});
