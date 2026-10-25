import {useMemo, useState} from 'react';
import {StyleSheet, View} from 'react-native';

import {type Box} from '@/src/analysis/carLabels';
import {type ChaseRoad} from '@/src/analysis/chaseRoad';
import {type FollowView} from '@/src/analysis/followView';
import {type OutlineUse} from '@/src/analysis/outlineUse';
import {type Radar as RadarData} from '@/src/analysis/radar';
import {FollowMap, type MapCar, Radar, TrackMap} from '@/src/charts';
import {measuredCentreLines, type MapPlacer} from '@/src/data/sessions';
import {classColor, radius, space, useTheme} from '@/src/design';
import {FOLLOW_SPANS_M, type MapZoom} from '@/src/state/comparePrefs';
import {
  MAP_ZOOM_BUTTONS_W,
  MAP_ZOOM_LABEL_W,
  MapZoomButtons,
  Segment,
  Skeleton,
  Text,
} from '@/src/ui';

import {type RaceDot} from '../model';
import {chaseAvailable, chaseNeedsRoad} from './ChaseView';
import {HeldChaseView} from './HeldChaseView';
import {type TowerCar} from '@/src/features/race/chase/towerRows';
import {type ChaseCar, type ChaseGaps, type ChaseInputs, type ChaseSampler} from '@/src/features/race/chase/chaseTypes';

// Dot radii in points by class, fastest first, from handoff R1d (desktop
// scale x1.15, phone x0.8); "other" takes the third size.
const RADIUS = {class1: 4.2, class2: 3.7, class3: 3.2, other: 3.2};
const YOU_RADIUS = 4.6;
const PHONE_SCALE = 0.8;
const DESKTOP_SCALE = 1.15;

export type LabelMode = 'off' | 'pos';
const LABEL_OPTIONS = [
  {value: 'off', label: 'Off'},
  {value: 'pos', label: 'Pos'},
] as const;
// The control's and the attribution's rough boxes, for label placement.
const LABEL_CONTROL_W = 100;
const LABEL_CONTROL_H = 32;
const MODE_CONTROL_H = 32;
const ZOOM_BUTTON_H = 28;
const ATTRIBUTION_W = 190;
const ATTRIBUTION_H = 12;

const NO_MARKS = {boundaries: [], sections: [], corners: []};
const NO_DOTS: never[] = [];
const NO_FOLLOW_LINES: never[] = [];
const NO_FOLLOW_TICKS: never[] = [];
const NO_POINTS: never[] = [];
const NO_CORNERS: never[] = [];
const MODE_OPTIONS = [
  {value: 'track', label: 'Track'},
  {value: 'follow', label: 'Follow'},
] as const;
const MODE_OPTIONS_3D = [...MODE_OPTIONS, {value: 'chase', label: '3D'}] as const;

/** Track: the whole circuit. Follow: a heading-up chase view of one car. 3D: the same chase, in perspective, with height. */
export type MapMode = 'track' | 'follow' | 'chase';

/** What the 3D chase needs beyond the cars: the road (fitted on first use, null when the field cannot give one), and whose eyes. */
export type RaceChase = {
  road: () => ChaseRoad | null;
  /** The road is being fitted: the map shows its placeholder until it returns. */
  building: boolean;
  /** The page is the Android app's WebView (embed=3d): full screen, no way out. */
  embedded: boolean;
  /** The cars now, for the strip; the engine samples its own with `sample`. */
  cars: ChaseCar[];
  sample: ChaseSampler;
  /** The race clock, seconds from the field's first update. */
  timeS: number;
  /** The car to follow: the focused one, else you. */
  focus: number | null;
  playing: boolean;
  rate: number;
  /** The player's recorded inputs for the lap in view; null until loaded. */
  inputs: ChaseInputs | null;
  gaps: ChaseGaps | null;
  /** The cars for the timing tower, and the track's length (for road distances). */
  tower: TowerCar[];
  trackM: number;
  /** The race clock as the transport prints it, and its play toggle, for the full-screen view. */
  clockLabel: string;
  onToggle: () => void;
  onStep: (deltaS: number) => void;
  onCycleRate: () => void;
};

/** What Follow needs: where the view sits (no size), and the road under it. */
export type RaceFollow = {
  view: Omit<FollowView, 'width' | 'height'>;
  band: {x: number; y: number}[][];
  bandFaded: {x: number; y: number}[][];
  /** A car is focused but cannot be chased (garage, no heading): this is you. */
  fellBack: boolean;
};

/**
 * The race map: the track (OSM outline when the fit is good, else the driven
 * band) and every car as a dot (R1, R1d). Cars are placed through the same
 * projection and georef as a lap's trace, so they land on the drawn track.
 */
export function RaceMap({
  width,
  height,
  desktop,
  placer,
  outlineUse,
  line,
  dots,
  showCars,
  attribution,
  radar,
  labels,
  onLabels,
  onPressCar,
  mode,
  onMode,
  follow,
  chase,
  zoom,
  onZoom,
}: {
  width: number;
  height: number;
  desktop: boolean;
  placer: MapPlacer;
  /** The outline split by the reference lap: used ways, and the rest (quiet). */
  outlineUse: OutlineUse;
  line: {x: number; y: number}[];
  dots: RaceDot[];
  /** False when the cars do not match the drawn track (see worldMatch). */
  showCars: boolean;
  attribution: string | null;
  /** The cars-around-you inset (R2), top right; null hides it. */
  radar: {
    width: number;
    height: number;
    rangeM: number;
    data: RadarData | null;
    sampleLabel?: string;
  } | null;
  /** Car labels on the map: off, or the class position (R1e). */
  labels: LabelMode;
  /** Null hides the switch: outside a race there is no position to label with. */
  onLabels: ((mode: LabelMode) => void) | null;
  onPressCar: (index: number) => void;
  mode: MapMode;
  /** Null hides the switch: the file has no headings, or nothing to chase. */
  onMode: ((mode: MapMode) => void) | null;
  follow: RaceFollow | null;
  /** Null hides the 3D option (no measured road, not on the web). */
  chase: RaceChase | null;
  /** Index into FOLLOW_SPANS_M; the Follow map's zoom. */
  zoom: MapZoom;
  onZoom: (zoom: MapZoom) => void;
}) {
  const {color} = useTheme();
  const following = mode === 'follow' && follow !== null;
  // the page that draws the 3D fits the road (the phone app's WebView page does its own)
  // Once the 3D has been shown it stays mounted, hidden, so Track and Follow do not rebuild it (HeldChaseView).
  const [kept, setKept] = useState(false);
  const chaseRoad =
    (mode === 'chase' || kept) && chase !== null && chaseAvailable && chaseNeedsRoad ? chase.road() : null;
  const chasing = mode === 'chase' && chase !== null && chaseAvailable && (!chaseNeedsRoad || chaseRoad !== null);
  const building = chase !== null && mode === 'chase' && chase.building;
  const chaseShown = chasing && !building;
  if (chaseShown && !kept) setKept(true);
  const scale = desktop ? DESKTOP_SCALE : PHONE_SCALE;
  const lines = useMemo(
    // Fits the view and is the band when there is no outline; no lap is drawn.
    () => [{key: 'ref', points: line, color: color.text, width: 1, opacity: 0}],
    [line, color.text],
  );
  const placed = useMemo(
    () => placer.placeWorld(dots.map(d => ({x: d.xM, z: d.zM}))),
    [placer, dots],
  );
  const cars = useMemo<MapCar[]>(
    () =>
      showCars
        ? dots.map((d, i) => ({
            key: String(d.index),
            at: placed[i],
            color: classColor(color, d.slot),
            radius: (d.player ? YOU_RADIUS : RADIUS[d.slot]) * scale,
            state: d.state === 'garage' ? 'running' : d.state,
            you: d.player,
            focused: d.focused,
            label: labels === 'pos' ? d.label : undefined,
            labelRank: d.labelRank,
          }))
        : [],
    [showCars, dots, placed, color, scale, labels],
  );
  // Labels keep off the control, the radar inset and the attribution.
  const avoid = useMemo<Box[]>(() => {
    const boxes: Box[] = [
      {
        x: space.sm,
        y: space.sm,
        width: LABEL_CONTROL_W,
        height: LABEL_CONTROL_H + (onMode ? MODE_CONTROL_H + space.xs : 0),
      },
      {
        x: width - 2 - ATTRIBUTION_W - space.md,
        y: height - 2 - ATTRIBUTION_H - space.xs,
        width: ATTRIBUTION_W,
        height: ATTRIBUTION_H,
      },
    ];
    if (following)
      boxes.push({
        x: space.xs,
        y: height - 2 - space.xs - ZOOM_BUTTON_H,
        width: MAP_ZOOM_BUTTONS_W + MAP_ZOOM_LABEL_W,
        height: ZOOM_BUTTON_H,
      });
    if (radar)
      boxes.push({
        x: width - 2 - space.sm - radar.width,
        y: space.sm,
        width: radar.width,
        height: radar.height,
      });
    return boxes;
  }, [width, height, radar, onMode, following]);
  return (
    <View
      style={[
        styles.frame,
        {
          width,
          height,
          borderColor: color.lineStrong,
          backgroundColor: color.surface,
        },
      ]}>
      {chase && kept ? (
        <View style={chaseShown ? undefined : styles.hidden}>
          <HeldChaseView
            active={chaseShown}
            width={width - 2}
            height={height - 2}
            road={chaseRoad}
            cars={chase.cars}
            sample={chase.sample}
            timeS={chase.timeS}
            focus={chase.focus}
            playing={chase.playing}
            inputs={chase.inputs}
            gaps={chase.gaps}
            tower={chase.tower}
            trackM={chase.trackM}
            clockLabel={chase.clockLabel}
            onToggle={chase.onToggle}
            onStep={chase.onStep}
            onCycleRate={chase.onCycleRate}
            rate={chase.rate}
            onPressCar={onPressCar}
            embedded={chase.embedded}
            />
        </View>
      ) : null}
      {building ? (
        <Skeleton height={height - 2} />
      ) : chaseShown ? null : following ? (
        <FollowMap
          width={width - 2}
          height={height - 2}
          centre={follow.view.centre}
          headingRad={follow.view.headingRad}
          visibleM={follow.view.visibleM}
          band={follow.band}
          bandFaded={follow.bandFaded}
          surface={placer.measured}
          lines={NO_FOLLOW_LINES}
          ticks={NO_FOLLOW_TICKS}
          dots={NO_DOTS}
          // The docked radar is the overview in this corner.
          inset={NO_POINTS}
          corners={NO_CORNERS}
          cars={cars}
          avoidLabels={avoid}
          onPressCar={key => onPressCar(Number(key))}
          scaleX={
            MAP_ZOOM_BUTTONS_W + MAP_ZOOM_LABEL_W + 2 * space.xs + space.sm
          }
        />
      ) : (
        <TrackMap
          width={width - 2}
          height={height - 2}
          outline={[
            ...measuredCentreLines(placer.measured),
            ...outlineUse.used,
          ]}
          outlineFaded={outlineUse.unused}
          pitLane={placer.pitLane}
          lines={lines}
          dots={NO_DOTS}
          marks={NO_MARKS}
          openSection={null}
          onPressSection={noop}
          cars={cars}
          avoidLabels={avoid}
          onPressCar={key => onPressCar(Number(key))}
        />
      )}
      <View style={styles.controls}>
        {onMode ? (
          <Segment
            options={chase && chaseAvailable ? MODE_OPTIONS_3D : MODE_OPTIONS}
            value={mode}
            onChange={onMode}
          />
        ) : null}
        {onLabels && !chasing ? (
          <Segment options={LABEL_OPTIONS} value={labels} onChange={onLabels} />
        ) : null}
      </View>
      {following && follow.fellBack ? (
        <View
          style={[styles.fellBack, {backgroundColor: color.surfaceOverlay}]}
          pointerEvents='none'>
          <Text variant='dataSmall' tone='textSecondary'>
            Following you
          </Text>
        </View>
      ) : null}
      {following ? (
        <MapZoomButtons
          canOut={zoom < FOLLOW_SPANS_M.length - 1}
          canIn={zoom > 0}
          onOut={() => onZoom((zoom + 1) as MapZoom)}
          onIn={() => onZoom((zoom - 1) as MapZoom)}
          rangeLabel={`${FOLLOW_SPANS_M[zoom]} m`}
        />
      ) : null}
      {radar && !chasing ? (
        <View style={styles.radar}>
          <Radar
            inset
            width={radar.width}
            height={radar.height}
            rangeM={radar.rangeM}
            radar={radar.data}
            sampleLabel={radar.sampleLabel}
          />
        </View>
      ) : null}
      {attribution && placer.real && !chasing ? (
        <Text variant='attribution' tone='textFaint' style={styles.credit}>
          {attribution}
        </Text>
      ) : null}
    </View>
  );
}

function noop() {}

const styles = StyleSheet.create({
  frame: {borderWidth: 1, borderRadius: radius.md, overflow: 'hidden'},
  hidden: {display: 'none'},
  controls: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    alignItems: 'flex-start',
    gap: space.xs,
  },
  fellBack: {
    position: 'absolute',
    bottom: space.xs,
    alignSelf: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
  },
  radar: {position: 'absolute', top: space.sm, right: space.sm},
  credit: {position: 'absolute', right: space.md, bottom: space.xs},
});
