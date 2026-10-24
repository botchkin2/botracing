import {useRouter} from 'expo-router';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {type LaneZoom, raceLanes} from '@/src/analysis/raceLanes';
import {lapPath} from '@/src/analysis/inputsPath';
import {carsAt} from '@/src/analysis/raceState';
import {fieldClasses} from '@/src/analysis/fieldClasses';
import {carLapsOf} from '@/src/analysis/carLaps';
import {updateAt} from '@/src/analysis/field';
import {RADAR_RANGE_M, radarAt} from '@/src/analysis/radar';
import {type GridTrace, traceCovers} from '@/src/analysis/resample';
import {traceAgrees} from '@/src/analysis/traceAgrees';
import {useLapTraceLoad} from '@/src/data/traces';
import {classColor, size, space, useLayout, useTheme} from '@/src/design';
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
  Pressable,
  Skeleton,
  StatusBanner,
  Text,
} from '@/src/ui';

import {nextRate, raceClockLabel, snapClock, stepBy} from './clock';
import {carLapsView} from './carLapsView';
import {chaseAvailable, chaseNeedsRoad} from './components/ChaseView';
import {Leaderboard} from './components/Leaderboard';
import {gapSeconds} from '@/src/analysis/chaseHud';
import {type TowerCar} from '@/src/features/race/chase/towerRows';
import {type ChaseCar, type ChaseGaps, type ChaseNow, type ChaseRibbon, type ChaseSampler} from '@/src/features/race/chase/chaseTypes';
import {RaceLegend} from './components/RaceLegend';
import {
  type LabelMode,
  type MapMode,
  RaceMap,
  type RaceChase,
  type RaceFollow,
} from './components/RaceMap';
import {RaceTransport} from './components/RaceTransport';
import {useEmbedClock} from './useEmbedClock';
import {RaceLanesBlock} from './components/RaceLanesBlock';
import {
  buildRaceModel,
  type ClassFilter,
  defaultFilter,
  displayModel,
  roadSummaryText,
} from './model';
import {
  raceTimeFor,
  type RaceSelection,
  selectionFor,
  type SelectionPatch,
} from './selectionClock';
import {followCar, followViewFor} from './followTarget';
import {phone3dHeight} from './phone3dHeight';
import {markPitLane} from './pitLaneState';
import {useRaceClock} from './useRaceClock';
import {type RaceData, useRaceData} from './useRaceData';

// Handoff R1a: map 358 x 260 on the phone, R1b: 1020 x 520 in a 1060 column.
const PHONE_MAP_H = 260;
/** In 3D the focus chip shares the mode row's line, at the right: what is left of a phone's width after the mode control. */
const CHIP_3D_MAX_W = 150;
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
const NO_LAP_TITLE = 'No timed lap to draw the track';
const NO_LINE_TITLE = 'No track line in this session';
const LINE_ERROR_TEXT = 'Could not load the lap that draws the track';
const FIELD_LOADING_TEXT = 'Loading field data';
const FIELD_ERROR_TEXT = 'Field data didn’t load';
const SKELETON_ROWS = 8;

// Compare's cursor settles this long after the clock stops, like Compare's own.
const SETTLE_MS = 400;

export function RaceScreen({
  sessionId,
  selection,
  onSelectionChange,
  embed3d = false,
}: {
  sessionId: string;
  selection: RaceSelection;
  onSelectionChange: (patch: SelectionPatch) => void;
  /** The page is the Android app's WebView (`embed=3d`): it opens on the 3D, full screen. */
  embed3d?: boolean;
}) {
  const data = useRaceData(sessionId);
  return (
    <RaceShell
      sessionId={sessionId}
      data={data}
      selection={selection}
      onSelectionChange={onSelectionChange}
      embed3d={embed3d}
    />
  );
}

function RaceShell({
  sessionId,
  data,
  selection,
  onSelectionChange,
  embed3d,
}: {
  sessionId: string;
  data: RaceData;
  selection: RaceSelection;
  onSelectionChange: (patch: SelectionPatch) => void;
  embed3d: boolean;
}) {
  const {color} = useTheme();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const router = useRouter();
  const title = 'title' in data ? data.title : 'Race';
  // The Android app's WebView: the 3D and nothing else, a dark page until it is ready.
  if (embed3d) {
    return (
      <View style={[styles.screen, {backgroundColor: color.bg}]}>
        {data.kind === 'ready' ? (
          <RaceView data={data} selection={selection} onSelectionChange={onSelectionChange} embed3d />
        ) : null}
      </View>
    );
  }
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
      {data.kind === 'ready' && data.note ? (
        <Text tone='textMuted' style={{paddingHorizontal: space.md, paddingBottom: space.sm}}>
          {data.note}
        </Text>
      ) : null}
      {data.kind === 'ready' ? (
        <RaceView
          data={data}
          selection={selection}
          onSelectionChange={onSelectionChange}
          embed3d={embed3d}
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
  if (
    data.kind === 'no-field' ||
    data.kind === 'no-lap' ||
    data.kind === 'no-line'
  ) {
    return (
      <View style={styles.center}>
        <EmptyState
          title={
            data.kind === 'no-lap'
              ? NO_LAP_TITLE
              : data.kind === 'no-line'
              ? NO_LINE_TITLE
              : NO_FIELD_TITLE
          }
          body={data.kind === 'no-field' ? data.why ?? undefined : undefined}
        />
      </View>
    );
  }
  if (data.kind === 'field-error' || data.kind === 'line-error') {
    return (
      <View style={[styles.notice, {width}]}>
        <StatusBanner
          dot='idle'
          text={
            data.kind === 'line-error'
              ? LINE_ERROR_TEXT
              : data.offline
              ? 'Offline'
              : FIELD_ERROR_TEXT
          }
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
  embed3d,
}: {
  data: Extract<RaceData, {kind: 'ready'}>;
  selection: RaceSelection;
  onSelectionChange: (patch: SelectionPatch) => void;
  embed3d: boolean;
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
  // in 3D React sees the clock at the field's own rate: the engine draws from its own clock every frame
  const [mapMode, setMapMode] = useState<MapMode>(embed3d ? 'chase' : 'track');
  const clock = useRaceClock(endS, openAt, mapMode === 'chase' && chaseAvailable ? prep.field.hz : 0);
  // In the app's WebView the app's clock is the clock (embedBridge.ts).
  useEmbedClock(clock, endS, embed3d);
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
  // The session's classes, fastest first, with their colours and labels.
  const classes = useMemo(() => fieldClasses(prep.field), [prep.field]);
  const [zoom, setZoom] = useState<LaneZoom>('l10');
  const [focus, setFocus] = useState<number | null>(null);
  const [wanted, setWanted] = useState<ClassFilter | null>(null);
  // Phone: the legend is folded away until asked for.
  const [keyOpen, setKeyOpen] = useState(false);
  // R1e: per view; the design's third mode (car number) needs numbers the
  // field upload does not carry.
  const [labels, setLabels] = useState<LabelMode>('pos');
  // Compare's Follow zoom, so the two chase views keep one setting. A stored
  // zoom outside the steps (a hand-edited or old save) reads as 1x.
  const prefs = useComparePrefs();
  const mapZoom: MapZoom =
    FOLLOW_SPANS_M[prefs.mapZoom] === undefined ? 1 : prefs.mapZoom;

  // Playing interpolates between the 5 Hz updates; paused rests on a real one.
  const snap = !clock.playing;
  const shownS = snap ? snapClock(clock.timeS, prep.field.hz) : clock.timeS;
  const u = updateAt(times, shownS);
  // The race clock counts from the start, not from the first update.
  const startS = prep.startU < times.length ? times[prep.startU] : 0;
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
        classes,
      }),
    [sampleCars, filter, focus, mode, prep.trackM, classes],
  );
  // The focused car's laps from the whole field, once per car picked; no
  // laps (or no car) means no panel.
  const carLaps = useMemo(() => {
    if (focus === null) return null;
    const car = sampleCars.find(c => c.index === focus);
    if (!car) return null;
    const view = carLapsView(
      carLapsOf(prep.field, focus),
      classes.of(car.classKey).title,
    );
    return view ? {index: focus, view} : null;
    // sampleCars only supplies the class, which never changes for a car.
  }, [focus, prep.field, classes]);
  const dots = useMemo(
    () =>
      buildRaceModel({cars, filter, focus, mode, trackM: prep.trackM, classes})
        .dots,
    [cars, filter, focus, mode, prep.trackM, classes],
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
        classes,
      ),
    [prep, radarU, radarSize, classes],
  );
  // Desktop: the map takes everything left of the leaderboard and the height
  // left after the legend, lanes and transport, so both are measured, not set.
  const [columnW, setColumnW] = useState(0);
  const [mapBox, setMapBox] = useState({width: 0, height: 0});
  const mapW = desktop ? mapBox.width : layout.contentWidth;
  const phone3d = !desktop && mapMode === 'chase' && chaseAvailable && data.chase !== null;
  const mapH = desktop
    ? mapBox.height
    : phone3d
    ? phone3dHeight(layout.height)
    : PHONE_MAP_H;
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
  // The player's own inputs for the lap in view (the stored field has none): the lap's trace, loaded only while the 3D chase is open.
  // 3D runs wherever the platform has it: the web at any width, the phone included (native has none yet).
  const chaseOk = chaseAvailable;
  const place = mapMode === 'chase' && chaseOk ? data.clock.playerAt(shownS) : null;
  const lapId = place ? data.laps.find(l => l.lapNumber === place.lapNumber)?.id ?? null : null;
  const [held, setHeld] = useState<{trace: GridTrace; lapNumber: number} | null>(null);
  const traceLoad = useLapTraceLoad(lapId ? [lapId] : [], {lengthM: prep.trackM, stepM: 5});
  const loaded = traceLoad.traces[0];
  if (loaded && place && held?.trace !== loaded) setHeld({trace: loaded, lapNumber: place.lapNumber});
  // Between two laps the last lap's trace stays on screen until the next one arrives.
  const shown = loaded && place ? {trace: loaded, lapNumber: place.lapNumber} : mapMode === 'chase' ? held : null;
  const trace = shown?.trace ?? null;
  const lapNumber = shown?.lapNumber ?? null;
  const world = data.chase?.world;
  // The page that draws the 3D fits its road, in slices, the first time the 3D is asked for.
  const requestWorld = data.chase?.request;
  useEffect(() => {
    if (mapMode === 'chase' && chaseNeedsRoad) requestWorld?.();
  }, [mapMode, requestWorld]);
  // The path is the player's own world path through the field (the same points the car is drawn at); the colours are
  // the trace's, on the same distance grid. The trace's GPS is in another frame than the road and the cars.
  const ribbon = useMemo<ChaseRibbon | null>(() => {
    if (!trace || trace.lat.length < 8 || lapNumber === null) return null;
    const prepW = world?.()?.prep;
    if (!prepW) return null;
    const path = lapPath(data.clock, lapNumber, trace.lat.length, trace.stepM, t => {
      const me = carsAt(prepW, t, false, true).find(c => c.player);
      return me ? {x: me.xM, y: me.zM} : null;
    });
    return path ? {x: path.x, y: path.y, th: trace.throttlePct, br: trace.brakePct, stepM: trace.stepM} : null;
  }, [trace, lapNumber, world, data.clock]);
  // The inputs are shown only where the lap's trace is where the player is: on the grid, in the pit lane or after a
  // reset the trace is somewhere else, and its pedals would be another stretch's.
  const player = cars.find(c => c.player) ?? null;
  const inputsNow = useMemo<ChaseNow | null>(() => {
    if (!trace || !place || !loaded || !ribbon || !player) return null;
    const i = Math.max(0, Math.min(trace.distanceM.length - 1, Math.round(place.distanceM / trace.stepM)));
    if (Math.hypot(ribbon.x[i] - player.xM, ribbon.y[i] - player.zM) > 20) return null;
    // outside what the trace recorded its end values are held, and held end values are not inputs (R1 6 lap 0)
    if (!traceCovers(trace, place.distanceM)) return null;
    // inside it the trace can still be another pass over the same distance: R1 6's lap 0 holds the formation lap there
    // (105 km/h, gear 2) where the car is doing 225 on the race lap, so the car's own speed must agree
    if (!traceAgrees(trace.speedKph[i], player.speedKmh)) return null;
    return {idx: i, throttlePct: trace.throttlePct[i], brakePct: trace.brakePct[i], steeringPct: trace.steeringPct[i], gear: trace.gear[i], speedKph: trace.speedKph[i]};
  }, [trace, place, loaded, ribbon, player]);
  const inputs = ribbon ? {ribbon, now: inputsNow} : null;
  // The followed car's class place and the gaps to the car ahead and behind in its class (the standings' own intervals).
  const chaseGaps = useMemo<ChaseGaps | null>(() => {
    const me = cars.find(c => c.index === focus) ?? cars.find(c => c.player);
    if (!me || me.classPlace <= 0) return null;
    const behind = cars.find(c => c.classKey === me.classKey && c.classPlace === me.classPlace + 1);
    return {
      classTag: classes.of(me.classKey).title,
      classPlace: me.classPlace,
      ...gapSeconds({
        intervalAheadS: me.intervalS,
        intervalBehindS: behind?.intervalS ?? null,
        beforeStart: shownS < startS,
      }),
    };
  }, [cars, focus, classes, shownS, startS]);
  // The 3D chase: every car as the map has it, on the road the game measured. The engine samples the cars itself at
  // its own clock on every animation frame (thread 93: no second smoothing on top of the field's interpolation).
  const toChase = useCallback(
    (list: typeof cars): ChaseCar[] =>
      list.map(c => ({
        index: c.index,
        xM: c.xM,
        zM: c.zM,
        headingRad: c.headingRad,
        speedKmh: Number.isFinite(c.speedKmh) ? c.speedKmh : 0,
        carClass: c.carClass,
        vehicle: c.vehicle,
        color: classColor(color, classes.of(c.classKey).slot),
        player: c.player,
        lapDistM: c.lapDistM,
        label: labels === 'pos' && c.classPlace > 0 ? String(c.classPlace) : '',
        state: c.state,
      })),
    [color, classes, labels],
  );
  // the 3D draws the field's own x/z (not re-placed on the surface's line), smoothed through the 5 Hz samples
  const sample = useCallback<ChaseSampler>(
    (t, snapped) => {
      const chasePrep = world?.()?.prep ?? prep;
      return toChase(markPitLane(carsAt(chasePrep, snapped ? snapClock(t, chasePrep.field.hz) : t, snapped, true), placer));
    },
    [toChase, world, prep, placer],
  );
  const tower = useMemo<TowerCar[]>(
    () =>
      cars.map(c => ({
        index: c.index,
        classPlace: c.classPlace,
        classKey: c.classKey,
        classTag: classes.of(c.classKey).title,
        color: classColor(color, classes.of(c.classKey).slot),
        model: displayModel(c.vehicle),
        lapDistM: c.lapDistM,
        // a grid has no gap, as in the HUD (gapSeconds)
        intervalS: shownS < startS ? null : c.intervalS,
        inGarage: c.state === 'garage',
      })),
    [cars, color, classes, shownS, startS],
  );
  const chase = useMemo<RaceChase | null>(
    () =>
      chaseOk && data.chase
        ? {
            road: () => world?.()?.road ?? null,
            building: data.chase.building,
            embedded: embed3d,
            cars: toChase(cars),
            sample,
            timeS: shownS,
            focus,
            playing: clock.playing,
            rate: clock.rate,
            inputs,
            gaps: chaseGaps,
            tower,
            trackM: prep.trackM,
            clockLabel: raceClockLabel(shownS, startS),
            onToggle: clock.toggle,
            onStep: (d: number) => clock.setTimeS(stepBy(clock.timeS, d, endS)),
            onCycleRate: () => clock.setRate(nextRate(clock.rate)),
          }
        : null,
    [data.chase, cars, toChase, sample, focus, clock.playing, clock.rate, inputs, shownS, startS, chaseGaps, tower, prep.trackM, chaseOk],
  );
  const toggleFocus = useCallback(
    (index: number) => setFocus(f => (f === index ? null : index)),
    [],
  );
  const count = `${rows.carCount} cars \u00b7 ${rows.classes.length} classes`;
  const sub = rows.you
    ? `${count} \u00b7 you ${rows.you.model} ${rows.you.cls.title}`
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
                  ? `${raceClockLabel(
                      times[Math.max(0, radarU)] ?? 0,
                      startS,
                    )} · 5 Hz`
                  : undefined,
              }
        }
        labels={labels}
        onLabels={mode === 'race' ? setLabels : null}
        onPressCar={toggleFocus}
        mode={mapMode}
        onMode={follow || chase ? setMapMode : null}
        follow={follow}
        chase={chase}
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
            // in 3D the bottom edge is the camera chips: the focus sits on the mode row, at the right
            phone3d && {top: space.sm, left: undefined, right: space.sm, bottom: undefined, maxWidth: CHIP_3D_MAX_W},
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
      startS={startS}
      // Never negative: columnW is 0 until onLayout, and an SVG with a
      // negative width logs an error.
      width={
        desktop ? Math.max(0, columnW - size.gutter * 2) : layout.contentWidth
      }
      desktop={desktop}
      onScrub={scrub}
      mode={mode}
    />
  );
  const controls = (
    <RaceTransport
      playing={clock.playing}
      rate={clock.rate}
      clock={raceClockLabel(shownS, startS)}
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
      carLaps={carLaps}
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
      carLaps={carLaps}
    />
  );

  if (desktop) {
    const column = (
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
        <RaceLegend classes={rows.classes} />
        {lanesBlock}
        {controls}
        {layout.isWide ? null : (
          <View style={[styles.boardBelow, {borderColor: color.line}]}>
            {board}
          </View>
        )}
      </View>
    );
    return (
      <View style={styles.desktop}>
        {layout.isWide ? (
          column
        ) : (
          // 900 to 1279: the map, lanes, controls and the board below add up to
          // more than a short window, so the column scrolls as a page; the map
          // keeps its least height and the board is never cut off by the fold.
          <ScrollView
            style={styles.fill}
            contentContainerStyle={styles.fillGrow}>
            {column}
          </ScrollView>
        )}
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
            {phone3d ? null : (
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
            )}
          </View>
          {roadLine ? (
            <Text variant='dataSmall' tone='textSecondary'>
              {roadLine}
            </Text>
          ) : null}
          {map}
          {keyOpen && !phone3d ? <RaceLegend classes={rows.classes} /> : null}
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
  fillGrow: {flexGrow: 1},
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
