import {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {type Box} from '@/src/analysis/carLabels';
import {type FollowView} from '@/src/analysis/followView';
import {type OutlineUse} from '@/src/analysis/outlineUse';
import {type Radar as RadarData} from '@/src/analysis/radar';
import {FollowMap, type MapCar, Radar, TrackMap} from '@/src/charts';
import {type MapPlacer} from '@/src/data/sessions';
import {radius, space, useTheme} from '@/src/design';
import {MAP_ZOOMS, type MapZoom} from '@/src/state/comparePrefs';
import {
  MAP_ZOOM_BUTTONS_W,
  MAP_ZOOM_LABEL_W,
  MapZoomButtons,
  Segment,
  Text,
} from '@/src/ui';

import {type RaceDot} from '../model';
import {classColor} from './classColor';

// Dot radii in points by class, from handoff R1d (desktop scale x1.15, phone
// x0.8); "other" classes take the GT3 size.
const RADIUS = {hypercar: 4.2, lmp2: 3.7, gt3: 3.2, other: 3.2};
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
const NO_FOLLOW_LINES: never[] = [];
const NO_FOLLOW_TICKS: never[] = [];
const NO_FOLLOW_DOTS: never[] = [];
const NO_POINTS: never[] = [];
const NO_CORNERS: never[] = [];
const MODE_OPTIONS = [
  {value: 'track', label: 'Track'},
  {value: 'follow', label: 'Follow'},
] as const;

/** Track: the whole circuit. Follow: a heading-up chase view of one car. */
export type MapMode = 'track' | 'follow';

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
  onLabels: (mode: LabelMode) => void;
  onPressCar: (index: number) => void;
  mode: MapMode;
  /** Null hides the switch: the file has no headings, or nothing to chase. */
  onMode: ((mode: MapMode) => void) | null;
  follow: RaceFollow | null;
  /** Index into MAP_ZOOMS; the Follow map's zoom. */
  zoom: MapZoom;
  onZoom: (zoom: MapZoom) => void;
}) {
  const {color} = useTheme();
  const following = mode === 'follow' && follow !== null;
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
            color: classColor(color, d.key),
            radius: (d.player ? YOU_RADIUS : RADIUS[d.key]) * scale,
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
      {following ? (
        <FollowMap
          width={width - 2}
          height={height - 2}
          centre={follow.view.centre}
          headingRad={follow.view.headingRad}
          visibleM={follow.view.visibleM * MAP_ZOOMS[zoom]}
          band={follow.band}
          bandFaded={follow.bandFaded}
          lines={NO_FOLLOW_LINES}
          ticks={NO_FOLLOW_TICKS}
          dots={NO_FOLLOW_DOTS}
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
          outline={outlineUse.used}
          outlineFaded={outlineUse.unused}
          pitLane={placer.pitLane}
          lines={lines}
          dots={[]}
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
          <Segment options={MODE_OPTIONS} value={mode} onChange={onMode} />
        ) : null}
        <Segment options={LABEL_OPTIONS} value={labels} onChange={onLabels} />
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
          canOut={zoom < MAP_ZOOMS.length - 1}
          canIn={zoom > 0}
          onOut={() => onZoom((zoom + 1) as MapZoom)}
          onIn={() => onZoom((zoom - 1) as MapZoom)}
          rangeLabel={`${Math.round(follow.view.visibleM * MAP_ZOOMS[zoom])} m`}
        />
      ) : null}
      {radar ? (
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
      {attribution && placer.real ? (
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
