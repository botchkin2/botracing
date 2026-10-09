import {useRouter} from 'expo-router';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {type LaneZoom, raceLanes} from '@/src/analysis/raceLanes';
import {carsAt} from '@/src/analysis/raceState';
import {updateAt} from '@/src/analysis/field';
import {RADAR_RANGE_M, radarAt} from '@/src/analysis/radar';
import {size, space, useLayout, useTheme} from '@/src/design';
import {SessionNav} from '@/src/workspace/SessionNav';
import {sessionHref} from '@/src/nav/routes';
import {
  FOLLOW_SPANS_M,
  type MapZoom,
  useComparePrefs,
} from '@/src/state/comparePrefs';
import {usePanelWidth} from '@/src/state/panelPrefs';
import {
  EmptyState,
  PANEL_DIVIDER_W,
  PanelDivider,
  Skeleton,
  StatusBanner,
  Text,
} from '@/src/ui';

import {clockLabel, nextRate, snapClock, stepBy} from './clock';
import {Leaderboard} from './components/Leaderboard';
import {RaceLegend} from './components/RaceLegend';
import {
  type LabelMode,
  type MapMode,
  RaceMap,
  type RaceFollow,
} from './components/RaceMap';
import {RaceTransport} from './components/RaceTransport';
import {RaceLanesBlock} from './components/RaceLanesBlock';
import {
  buildRaceModel,
  CLASS_TITLE,
  type ClassFilter,
  defaultFilter,
  roadSummaryText,
} from './model';
import {
  raceTimeFor,
  type RaceSelection,
  selectionFor,
  type SelectionPatch,
} from './selectionClock';
import {followCar, followViewFor} from './followTarget';
import {markPitLane} from './pitLaneState';
import {useRaceClock} from './useRaceClock';
import {type RaceData, useRaceData} from './useRaceData';

// Handoff R1a: map 358 x 260 on the phone, R1b: 1020 x 520 in a 1060 column.
const PHONE_MAP_H = 260;
// R1a / R1b: the radar inset over the map, top right.
const RADAR_PHONE = {width: 72, height: 108};
const RADAR_DESKTOP = {width: 150, height: 226};
// Skeleton height, and the least the desktop map is given on a short window.
const DESKTOP_MAP_H = 520;
const MAP_MIN_H = 240;
// The leaderboard's right column from 1280 (round 5, item 5); from 900 to 1279
// it goes below the lanes instead, at this height.
const DESKTOP_SIDE_W = 320;
// The wide map is kept at least this wide when the leaderboard is dragged out.
const WIDE_MIN_MAP_W = 560;
const BOARD_BELOW_H = 260;

const NO_FIELD_TITLE = 'No field data for this session';
const FIELD_LOADING_TEXT = 'Loading field data';
const FIELD_ERROR_TEXT = 'Field data didn’t load';
const SKELETON_ROWS = 8;

// Compare's cursor settles this long after the clock stops, like Compare's own.
const SETTLE_MS = 400;

export function RaceScreen({
  sessionId,
  selection,
  onSelectionChange,
}: {
  sessionId: string;
  selection: RaceSelection;
  onSelectionChange: (patch: SelectionPatch) => void;
}) {
  const data = useRaceData(sessionId);
  return (
    <RaceShell
      sessionId={sessionId}
      data={data}
      selection={selection}
      onSelectionChange={onSelectionChange}
    />
  );
}

function RaceShell({
  sessionId,
  data,
  selection,
  onSelectionChange,
}: {
  sessionId: string;
  data: RaceData;
  selection: RaceSelection;
  onSelectionChange: (patch: SelectionPatch) => void;
}) {
  const {color} = useTheme();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const router = useRouter();
  const title = 'title' in data ? data.title : 'Race';
  return (
    <View
      style={[
        styles.screen,
        {backgroundColor: color.bg, paddingTop: insets.top},
      ]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole='link'
          accessibilityLabel='Back to the session'
          onPress={() => router.navigate(sessionHref(sessionId))}
          hitSlop={space.md}
          style={styles.back}>
          <Text variant='title'>‹</Text>
        </Pressable>
        <Text variant='title' numberOfLines={1} style={styles.headerTitle}>
          {title}
        </Text>
      </View>
      {!layout.isDesktop && <SessionNav sessionId={sessionId} />}
      {data.kind === 'ready' ? (
        <RaceView
          data={data}
          selection={selection}
          onSelectionChange={onSelectionChange}
        />
      ) : (
        <Notice data={data} />
      )}
    </View>
  );
}

// Every state that is not the race: loading, no data, failed (R4c). Neutral
// wording, never amber or red. The banner says what is happening; the frames
// under it hold the map's and the leaderboard's real sizes so nothing moves
// when the field arrives.
function Notice({data}: {data: Exclude<RaceData, {kind: 'ready'}>}) {
  const layout = useLayout();
  const width = layout.contentWidth;
  if (data.kind === 'error') {
    return (
      <View style={styles.center}>
        <Text tone='textMuted'>{data.message}</Text>
      </View>
    );
  }
  if (data.kind === 'no-field') {
    return (
      <View style={styles.center}>
        <EmptyState title={NO_FIELD_TITLE} />
      </View>
    );
  }
  if (data.kind === 'field-error') {
    return (
      <View style={[styles.notice, {width}]}>
        <StatusBanner
          dot='idle'
          text={FIELD_ERROR_TEXT}
          actionLabel='Retry'
          onAction={data.retry}
        />
      </View>
    );
  }
  const rows = Array.from({length: SKELETON_ROWS}, (_, i) => (
    <Skeleton key={i} height={size.lapRow} />
  ));
  return (
    <View style={[styles.notice, {width}]}>
      {data.kind === 'field-loading' ? (
        <StatusBanner dot='waiting' text={FIELD_LOADING_TEXT} />
      ) : null}
      {layout.isDesktop ? (
        // Two columns like the desktop Race screen: the map, then the board.
        <View style={styles.noticeColumns}>
          <View style={styles.fill}>
            <Skeleton height={DESKTOP_MAP_H} />
          </View>
          <View style={[styles.noticeBoard, {width: DESKTOP_SIDE_W}]}>
            {rows}
          </View>
        </View>
      ) : (
        <>
          <Skeleton height={PHONE_MAP_H} />
          {rows}
        </>
      )}
    </View>
  );
}

function RaceView({
  data,
  selection,
  onSelectionChange,
}: {
  data: Extract<RaceData, {kind: 'ready'}>;
  selection: RaceSelection;
  onSelectionChange: (patch: SelectionPatch) => void;
}) {
  const {color} = useTheme();
  const {mode} = data;
  const layout = useLayout();
  const {prep, placer, line, outlineUse} = data;
  const times = prep.field.timeS;
  const endS = times.length > 0 ? times[times.length - 1] : 0;
  // Opens on Compare's cursor when the URL has one.
  const [openAt] = useState(
    () => raceTimeFor(selection, data.laps, data.clock) ?? 0,
  );
  const clock = useRaceClock(endS, openAt);
  // Race writes the cursor back once the user has moved the clock and it has
  // rested; opening the screen never overwrites Compare's cursor.
  const touched = useRef(false);
  const latest = useRef({selection, onSelectionChange});
  useEffect(() => {
    latest.current = {selection, onSelectionChange};
  });
  useEffect(() => {
    if (clock.playing || !touched.current) return;
    const timer = setTimeout(() => {
      const place = data.clock.playerAt(clock.timeS);
      if (!place) return;
      const {selection: sel, onSelectionChange: write} = latest.current;
      write(selectionFor(place, sel, data.laps));
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [clock.playing, clock.timeS, data.clock, data.laps]);
  const scrub = (timeS: number) => {
    touched.current = true;
    clock.setTimeS(timeS);
  };
  const toggle = () => {
    touched.current = true;
    clock.toggle();
  };
  // Built once per field, like the clock: it walks every update and car.
  const lanes = useMemo(
    () => raceLanes(prep.field, data.clock),
    [prep.field, data.clock],
  );
  const [zoom, setZoom] = useState<LaneZoom>('l10');
  const [focus, setFocus] = useState<number | null>(null);
  const [wanted, setWanted] = useState<ClassFilter | null>(null);
  // Phone: the legend is folded away until asked for.
  const [keyOpen, setKeyOpen] = useState(false);
  // R1e: per view; the design's third mode (car number) needs numbers the
  // field upload does not carry.
  const [labels, setLabels] = useState<LabelMode>('pos');
  const [mapMode, setMapMode] = useState<MapMode>('track');
  // Compare's Follow zoom, so the two chase views keep one setting. A stored
  // zoom outside the steps (a hand-edited or old save) reads as 1x.
  const prefs = useComparePrefs();
  const mapZoom: MapZoom =
    FOLLOW_SPANS_M[prefs.mapZoom] === undefined ? 1 : prefs.mapZoom;

  // Playing interpolates between the 5 Hz updates; paused rests on a real one.
  const snap = !clock.playing;
  const shownS = snap ? snapClock(clock.timeS, prep.field.hz) : clock.timeS;
  const u = updateAt(times, shownS);
  const cars = useMemo(
    () => markPitLane(carsAt(prep, shownS, snap), placer),
    [prep, shownS, snap, placer],
  );
  // Rows change with the sample, not with every frame.
  const sampleCars = useMemo(
    () => markPitLane(carsAt(prep, times[Math.max(0, u)] ?? 0, true), placer),
    [prep, times, u, placer],
  );
  // The phone outside a race opens on Nearby: the cars around you, any class.
  const filter =
    wanted ??
    defaultFilter(sampleCars, {nearby: mode === 'field' && !layout.isDesktop});
  const rows = useMemo(
    () =>
      buildRaceModel({
        cars: sampleCars,
        filter,
        focus,
        mode,
        trackM: prep.trackM,
      }),
    [sampleCars, filter, focus, mode, prep.trackM],
  );
  const dots = useMemo(
    () => buildRaceModel({cars, filter, focus, mode, trackM: prep.trackM}).dots,
    [cars, filter, focus, mode, prep.trackM],
  );

  // The radar shows the 5 Hz sample at or before the clock, even while the
  // map interpolates (R2).
  const radarU = updateAt(
    times,
    Math.floor(shownS * prep.field.hz) / prep.field.hz,
  );
  const desktop = layout.isDesktop;
  // The leaderboard beside the map (wide): resizable, kept per viewer.
  const boardPanel = usePanelWidth(
    'race',
    layout.width - WIDE_MIN_MAP_W - PANEL_DIVIDER_W,
  );
  const radarSize = desktop ? RADAR_DESKTOP : RADAR_PHONE;
  const radarData = useMemo(
    () =>
      radarAt(
        prep.field,
        radarU,
        RADAR_RANGE_M,
        (RADAR_RANGE_M * radarSize.width) / radarSize.height,
      ),
    [prep, radarU, radarSize],
  );
  // Desktop: the map takes everything left of the leaderboard and the height
  // left after the legend, lanes and transport, so both are measured, not set.
  const [columnW, setColumnW] = useState(0);
  const [mapBox, setMapBox] = useState({width: 0, height: 0});
  const mapW = desktop ? mapBox.width : layout.contentWidth;
  const mapH = desktop ? mapBox.height : PHONE_MAP_H;
  // Follow chases the focused car, else you; a file without headings (before
  // v2) or a car off the map has nothing to chase, so the switch is hidden.
  const chased = data.matches ? followCar(cars, focus) : null;
  const follow = useMemo<RaceFollow | null>(() => {
    if (!chased) return null;
    const view = followViewFor(placer, chased, FOLLOW_SPANS_M[mapZoom]);
    if (!view) return null;
    return {
      view,
      band:
        placer.outline.length > 0 || placer.measured.length > 0
          ? outlineUse.used
          : [line],
      bandFaded: outlineUse.unused,
      fellBack: focus !== null && chased.index !== focus,
    };
  }, [chased, focus, placer, outlineUse, line, mapZoom]);
  const toggleFocus = useCallback(
    (index: number) => setFocus(f => (f === index ? null : index)),
    [],
  );
  const count = `${rows.carCount} cars \u00b7 ${rows.classes.length} classes`;
  const sub = rows.you
    ? `${count} \u00b7 you ${rows.you.model} ${CLASS_TITLE[rows.you.key]}`
    : count;
  // Outside a race: who is near you on the road, in place of a position.
  const roadLine = rows.road ? roadSummaryText(rows.road) : '';

  const map = data.roadPending ? (
    <Skeleton height={mapH} />
  ) : (
    <View>
      <RaceMap
        width={mapW}
        height={mapH}
        desktop={desktop}
        placer={placer}
        line={line}
        outlineUse={outlineUse}
        dots={dots}
        showCars={data.matches}
        attribution={data.attribution}
        // A field placed on the line by lap distance has no lateral picture:
        // a radar would invent overlap (pit-wall thread 1, #2962).
        radar={
          prep.field.placedOnLine
            ? null
            : {
                ...radarSize,
                rangeM: RADAR_RANGE_M,
                data: radarData,
                // The sample time is printed on the large sizes only (R2).
                sampleLabel: desktop
                  ? `${clockLabel(times[Math.max(0, radarU)] ?? 0)} · 5 Hz`
                  : undefined,
              }
        }
        labels={labels}
        onLabels={mode === 'race' ? setLabels : null}
        onPressCar={toggleFocus}
        mode={mapMode}
        onMode={follow ? setMapMode : null}
        follow={follow}
        zoom={mapZoom}
        onZoom={prefs.setMapZoom}
      />
      {rows.focusLabel ? (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Clear focus'
          onPress={() => setFocus(null)}
          style={[
            styles.chip,
            {borderColor: color.accent, backgroundColor: color.surfaceRaised},
          ]}>
          <Text
            variant='dataSmall'
            numberOfLines={1}>{`${rows.focusLabel} ×`}</Text>
        </Pressable>
      ) : null}
      {!data.matches ? (
        <Text variant='dataSmall' tone='textMuted' style={styles.matchNote}>
          {data.matchM === null
            ? 'Cars not drawn: no track map match'
            : `Cars not drawn: ${Math.round(data.matchM)} m off the track map`}
        </Text>
      ) : null}
    </View>
  );
  const lanesBlock = (
    <RaceLanesBlock
      lanes={lanes}
      zoom={zoom}
      onZoom={setZoom}
      playheadS={shownS}
      width={desktop ? columnW - size.gutter * 2 : layout.contentWidth}
      desktop={desktop}
      onScrub={scrub}
      mode={mode}
    />
  );
  const controls = (
    <RaceTransport
      playing={clock.playing}
      rate={clock.rate}
      clock={clockLabel(shownS)}
      onToggle={toggle}
      onRate={clock.setRate}
      phone={
        desktop
          ? undefined
          : {
              lanes,
              playheadS: shownS,
              width: layout.contentWidth,
              onScrub: scrub,
              onStep: deltaS => scrub(stepBy(clock.timeS, deltaS, endS)),
              onCycleRate: () => clock.setRate(nextRate(clock.rate)),
            }
      }
    />
  );
  const board = (
    <Leaderboard
      groups={rows.groups}
      classes={rows.classes}
      filter={rows.filter}
      onFilter={setWanted}
      onFocus={toggleFocus}
      desktop={desktop}
      mode={mode}
      nearby={mode === 'field'}
      fallbackNote={rows.fallbackNote}
    />
  );
  const boardPaged = (
    <Leaderboard
      groups={rows.groups}
      classes={rows.classes}
      filter={rows.filter}
      onFilter={setWanted}
      onFocus={toggleFocus}
      desktop={desktop}
      mode={mode}
      paged
      nearby={mode === 'field'}
      fallbackNote={rows.fallbackNote}
    />
  );

  if (desktop) {
    return (
      <View style={styles.desktop}>
        <View
          style={styles.mapColumn}
          onLayout={e => setColumnW(e.nativeEvent.layout.width)}>
          <View style={styles.subRow}>
            <Text variant='dataSmall' tone='textMuted' style={styles.flexFill}>
              {sub}
            </Text>
          </View>
          {roadLine ? (
            <Text variant='dataSmall' tone='textSecondary'>
              {roadLine}
            </Text>
          ) : null}
          <View
            style={styles.mapFill}
            onLayout={e =>
              setMapBox({
                width: Math.floor(e.nativeEvent.layout.width),
                height: Math.floor(e.nativeEvent.layout.height),
              })
            }>
            {mapBox.width > 0 && mapBox.height > 0 ? map : null}
          </View>
          <RaceLegend />
          {lanesBlock}
          {controls}
          {layout.isWide ? null : (
            <View style={[styles.boardBelow, {borderColor: color.line}]}>
              {board}
            </View>
          )}
        </View>
        {layout.isWide ? (
          <>
            <PanelDivider
              width={boardPanel.width}
              onResize={boardPanel.onResize}
              onCommit={boardPanel.onCommit}
              onReset={boardPanel.reset}
              label='Resize the leaderboard panel'
            />
            <View style={{width: boardPanel.width}}>{board}</View>
          </>
        ) : null}
      </View>
    );
  }
  // The phone screen scrolls as a page: the map at its height, the board
  // below at full length, the lanes after it; the transport stays under the
  // page (thread 44 #1733).
  return (
    <View style={styles.fill}>
      <ScrollView style={styles.fill}>
        <View style={styles.phoneTop}>
          <View style={styles.subRow}>
            <Text variant='dataSmall' tone='textMuted' style={styles.flexFill}>
              {sub}
            </Text>
            <Pressable
              accessibilityRole='button'
              accessibilityState={{expanded: keyOpen}}
              accessibilityLabel='Key'
              onPress={() => setKeyOpen(o => !o)}
              hitSlop={space.md}
              style={styles.keyToggle}>
              <Text variant='dataSmall' tone='accentInk'>
                {keyOpen ? 'Key ▴' : 'Key ▾'}
              </Text>
            </Pressable>
          </View>
          {roadLine ? (
            <Text variant='dataSmall' tone='textSecondary'>
              {roadLine}
            </Text>
          ) : null}
          {map}
          {keyOpen ? <RaceLegend /> : null}
        </View>
        {boardPaged}
        <View style={styles.phoneLanes}>{lanesBlock}</View>
      </ScrollView>
      {controls}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  fill: {flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: size.gutter,
    height: size.hit,
  },
  // A 44 pt square: the chevron glyph alone is 24 x 20.
  back: {
    width: size.hit,
    height: size.hit,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {flex: 1},
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    padding: size.gutter,
  },
  notice: {alignSelf: 'center', gap: space.sm, paddingTop: space.lg},
  noticeColumns: {flexDirection: 'row', gap: space.xl},
  noticeBoard: {gap: space.sm},
  phoneLanes: {paddingHorizontal: size.gutter, paddingTop: space.md},
  phoneTop: {paddingHorizontal: size.gutter, gap: space.md},
  desktop: {flex: 1, flexDirection: 'row', alignSelf: 'stretch'},
  mapColumn: {flex: 1, gap: space.md, paddingHorizontal: size.gutter},
  // The map's own box; the map is drawn to its measured size.
  mapFill: {flex: 1, minHeight: MAP_MIN_H},
  boardBelow: {height: BOARD_BELOW_H, borderTopWidth: 1},
  chip: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.md,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  matchNote: {marginTop: space.xs},
  subRow: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  flexFill: {flex: 1},
  keyToggle: {
    minWidth: size.hit,
    minHeight: size.hit,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
