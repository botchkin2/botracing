import {useRouter} from 'expo-router';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {type LaneZoom, raceLanes} from '@/src/analysis/raceLanes';
import {carsAt} from '@/src/analysis/raceState';
import {updateAt} from '@/src/analysis/field';
import {RADAR_RANGE_M, radarAt} from '@/src/analysis/radar';
import {size, space, useLayout, useTheme} from '@/src/design';
import {sessionHref} from '@/src/nav/routes';
import {EmptyState, Skeleton, StatusBanner, Text} from '@/src/ui';

import {clockLabel, snapClock} from './clock';
import {Leaderboard} from './components/Leaderboard';
import {RaceLegend} from './components/RaceLegend';
import {type LabelMode, RaceMap} from './components/RaceMap';
import {RaceTransport} from './components/RaceTransport';
import {RaceLanesBlock} from './components/RaceLanesBlock';
import {
  buildRaceModel,
  CLASS_TITLE,
  type ClassFilter,
  defaultFilter,
} from './model';
import {
  raceTimeFor,
  type RaceSelection,
  selectionFor,
  type SelectionPatch,
} from './selectionClock';
import {useRaceClock} from './useRaceClock';
import {type RaceData, useRaceData} from './useRaceData';

// Handoff R1a: map 358 x 260 on the phone, R1b: 1020 x 520 in a 1060 column.
const PHONE_MAP_H = 260;
// R1a / R1b: the radar inset over the map, top right.
const RADAR_PHONE = {width: 72, height: 108};
const RADAR_DESKTOP = {width: 150, height: 226};
const DESKTOP_MAP_H = 520;
const DESKTOP_SIDE_W = 380;

// Copy from handoff R4c, verbatim where it is drawn.
const NO_FIELD_TITLE = 'No field data for this session';
const NO_FIELD_BODY =
  'Other cars are recorded for sessions from 28 Sep 2026 on. Your laps and traces work as before.';

// Handoff R4c, drawn here; no download progress or timeout is measured, so
// the byte counts and "after 30 s" of the handoff copy are left out.
const FIELD_LOADING_TEXT =
  'Loading field data. Your laps and traces already work.';
const FIELD_ERROR_TEXT =
  'Field data didn’t load. Your laps and traces still work.';
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
        <EmptyState title={NO_FIELD_TITLE} body={NO_FIELD_BODY} />
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
  // R1e: per view; the design's third mode (car number) needs numbers the
  // field upload does not carry.
  const [labels, setLabels] = useState<LabelMode>('pos');

  // Playing interpolates between the 5 Hz updates; paused rests on a real one.
  const snap = !clock.playing;
  const shownS = snap ? snapClock(clock.timeS, prep.field.hz) : clock.timeS;
  const u = updateAt(times, shownS);
  const cars = useMemo(() => carsAt(prep, shownS, snap), [prep, shownS, snap]);
  // Rows change with the sample, not with every frame.
  const sampleCars = useMemo(
    () => carsAt(prep, times[Math.max(0, u)] ?? 0, true),
    [prep, times, u],
  );
  const filter = wanted ?? defaultFilter(sampleCars);
  const rows = useMemo(
    () => buildRaceModel({cars: sampleCars, filter, focus}),
    [sampleCars, filter, focus],
  );
  const dots = useMemo(
    () => buildRaceModel({cars, filter, focus}).dots,
    [cars, filter, focus],
  );

  // The radar shows the 5 Hz sample at or before the clock, even while the
  // map interpolates (R2).
  const radarU = updateAt(
    times,
    Math.floor(shownS * prep.field.hz) / prep.field.hz,
  );
  const desktop = layout.isDesktop;
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
  const mapW = desktop
    ? layout.contentWidth - DESKTOP_SIDE_W - size.gutter
    : layout.contentWidth;
  const toggleFocus = useCallback(
    (index: number) => setFocus(f => (f === index ? null : index)),
    [],
  );
  const sub = rows.you
    ? `${rows.carCount} cars · ${rows.classes.length} classes · you ${
        rows.you.model
      } ${CLASS_TITLE[rows.you.key]}`
    : `${rows.carCount} cars · ${rows.classes.length} classes`;

  const map = (
    <View>
      <RaceMap
        width={mapW}
        height={desktop ? DESKTOP_MAP_H : PHONE_MAP_H}
        desktop={desktop}
        placer={placer}
        line={line}
        outlineUse={outlineUse}
        dots={dots}
        showCars={data.matches}
        attribution={data.attribution}
        radar={{
          ...radarSize,
          rangeM: RADAR_RANGE_M,
          data: radarData,
          // The sample time is printed on the large sizes only (R2).
          sampleLabel: desktop
            ? `${clockLabel(times[Math.max(0, radarU)] ?? 0)} · 5 Hz`
            : undefined,
        }}
        labels={labels}
        onLabels={setLabels}
        onPressCar={toggleFocus}
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
        <Text variant='explainer' tone='textMuted' style={styles.matchNote}>
          {data.matchM === null
            ? 'The cars could not be checked against this track map, so they are not drawn.'
            : `The cars are ${Math.round(
                data.matchM,
              )} m from this track map, so they are not drawn.`}
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
      width={mapW}
      desktop={desktop}
      onScrub={scrub}
    />
  );
  const controls = (
    <RaceTransport
      playing={clock.playing}
      rate={clock.rate}
      clock={clockLabel(shownS)}
      onToggle={toggle}
      onRate={clock.setRate}
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
    />
  );

  if (desktop) {
    return (
      <View style={[styles.desktop, {width: layout.contentWidth}]}>
        <View style={styles.mapColumn}>
          <Text variant='dataSmall' tone='textMuted'>
            {sub}
          </Text>
          {map}
          <RaceLegend />
          {lanesBlock}
          {controls}
        </View>
        <View style={[styles.side, {borderColor: color.line}]}>{board}</View>
      </View>
    );
  }
  return (
    <View style={styles.fill}>
      <View style={styles.phoneTop}>
        <Text variant='dataSmall' tone='textMuted'>
          {sub}
        </Text>
        {map}
        <RaceLegend />
      </View>
      {board}
      <View style={styles.phoneLanes}>{lanesBlock}</View>
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
  back: {width: space.xxl, alignItems: 'center'},
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
  desktop: {
    flex: 1,
    flexDirection: 'row',
    alignSelf: 'center',
    gap: size.gutter,
  },
  mapColumn: {flex: 1, gap: space.md, paddingHorizontal: size.gutter},
  side: {width: DESKTOP_SIDE_W, borderLeftWidth: 1},
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
});
