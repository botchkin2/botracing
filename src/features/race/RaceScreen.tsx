import {useRouter} from 'expo-router';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {carsAt} from '@/src/analysis/raceState';
import {updateAt} from '@/src/analysis/field';
import {size, space, useLayout, useTheme} from '@/src/design';
import {sessionHref} from '@/src/nav/routes';
import {Button, Text} from '@/src/ui';

import {clockLabel, snapClock} from './clock';
import {Leaderboard} from './components/Leaderboard';
import {RaceLegend} from './components/RaceLegend';
import {RaceMap} from './components/RaceMap';
import {RaceTransport} from './components/RaceTransport';
import {Scrubber} from './components/Scrubber';
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
const DESKTOP_MAP_H = 520;
const DESKTOP_SIDE_W = 380;

// Copy from handoff R4c, verbatim where it is drawn.
const NO_FIELD_TITLE = 'No field data for this session';
const NO_FIELD_BODY =
  'Other cars are recorded for sessions from 28 Sep 2026 on. Your laps and traces work as before.';

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
// wording, never amber or red.
function Notice({data}: {data: Exclude<RaceData, {kind: 'ready'}>}) {
  const {color} = useTheme();
  if (data.kind === 'loading' || data.kind === 'field-loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color.accent} />
        {data.kind === 'field-loading' ? (
          <Text variant='body' tone='textMuted' style={styles.noticeText}>
            Loading field data. Your laps and traces already work.
          </Text>
        ) : null}
      </View>
    );
  }
  if (data.kind === 'error') {
    return (
      <View style={styles.center}>
        <Text tone='textMuted'>{data.message}</Text>
      </View>
    );
  }
  if (data.kind === 'field-error') {
    return (
      <View style={styles.center}>
        <Text variant='body' tone='textMuted' style={styles.noticeText}>
          Field data didn’t load. Your laps and traces still work.
        </Text>
        <Button label='Retry' kind='outline' onPress={data.retry} />
      </View>
    );
  }
  return (
    <View style={styles.center}>
      <Text variant='bodyStrong'>{NO_FIELD_TITLE}</Text>
      <Text variant='body' tone='textMuted' style={styles.noticeText}>
        {NO_FIELD_BODY}
      </Text>
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
  const {prep, placer, line} = data;
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
  const [focus, setFocus] = useState<number | null>(null);
  const [wanted, setWanted] = useState<ClassFilter | null>(null);

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

  const desktop = layout.isDesktop;
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
        dots={dots}
        showCars={data.matches}
        attribution={data.attribution}
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
  const controls = (
    <>
      <Scrubber
        value={endS > 0 ? clock.timeS / endS : 0}
        onChange={v => scrub(v * endS)}
      />
      <RaceTransport
        playing={clock.playing}
        rate={clock.rate}
        clock={clockLabel(shownS)}
        onToggle={toggle}
        onRate={clock.setRate}
      />
    </>
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
  noticeText: {textAlign: 'center'},
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
