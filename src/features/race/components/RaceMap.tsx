import {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {type Box} from '@/src/analysis/carLabels';
import {FOLLOW_WHOLE_LAP_M} from '@/src/analysis/followView';
import {type OutlineUse} from '@/src/analysis/outlineUse';
import {type Radar as RadarData} from '@/src/analysis/radar';
import {
  type FollowDot,
  FollowMap,
  type MapCar,
  MapZoomButtons,
  Radar,
  TrackMap,
} from '@/src/charts';
import {type MapPlacer} from '@/src/data/sessions';
import {radius, space, useTheme} from '@/src/design';
import {MAP_ZOOMS, type MapZoom} from '@/src/state/comparePrefs';
import {Segment, Text} from '@/src/ui';

import {type FollowCamera} from '../followCamera';
import {type RaceDot} from '../model';
import {classColor} from './classColor';

// Dot radii in points by class, from handoff R1d (desktop scale x1.15, phone
// x0.8); "other" classes take the GT3 size.
const RADIUS = {hypercar: 4.2, lmp2: 3.7, gt3: 3.2, other: 3.2};
const YOU_RADIUS = 4.6;
const PHONE_SCALE = 0.8;
const DESKTOP_SCALE = 1.15;

export type MapMode = 'follow' | 'track';
const MODE_OPTIONS = [
  {value: 'follow', label: 'Follow'},
  {value: 'track', label: 'Track'},
] as const;
// Follow shows this much track top to bottom at 1x (Compare's whole-lap span).
const FOLLOW_VISIBLE_M = FOLLOW_WHOLE_LAP_M;
// The scale bar sits at the bottom left; the zoom buttons ride above it.
const ZOOM_BOTTOM = 40;

export type LabelMode = 'off' | 'pos';
const LABEL_OPTIONS = [
  {value: 'off', label: 'Off'},
  {value: 'pos', label: 'Pos'},
] as const;
// The control's and the attribution's rough boxes, for label placement.
const LABEL_CONTROL_W = 100;
const LABEL_CONTROL_H = 32;
// The mode switch is stacked above the labels switch in Track.
const MODE_CONTROL_H = 32;
const ATTRIBUTION_W = 190;
const ATTRIBUTION_H = 12;

const NO_MARKS = {boundaries: [], sections: [], corners: []};
const NO_LINES: never[] = [];
const NO_TICKS: never[] = [];
const NO_INSET: never[] = [];
const NO_CORNERS: never[] = [];

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
  camera,
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
  onMode: (mode: MapMode) => void;
  /** Where Follow looks; null (no yaw, garage) draws the Track instead. */
  camera: FollowCamera | null;
  zoom: MapZoom;
  onZoom: (zoom: MapZoom) => void;
}) {
  const {color} = useTheme();
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
  const following = mode === 'follow' && camera != null;
  const visibleM = FOLLOW_VISIBLE_M * MAP_ZOOMS[zoom];
  // Cars inside the frame (its half diagonal from the camera); the rest are
  // off the map and are not drawn.
  const followDots = useMemo<FollowDot[]>(() => {
    if (!following || !showCars) return [];
    const reach = (Math.hypot(width, height) / height) * visibleM;
    return dots.flatMap((d, i) => {
      const at = placed[i];
      if (Math.hypot(at.x - camera.centre.x, at.y - camera.centre.y) > reach)
        return [];
      return [
        {
          key: String(d.index),
          at,
          color: d.player ? color.accent : classColor(color, d.key),
        },
      ];
    });
  }, [
    following,
    showCars,
    camera,
    dots,
    placed,
    width,
    height,
    visibleM,
    color,
  ]);
  // Labels keep off the control, the radar inset and the attribution.
  const avoid = useMemo<Box[]>(() => {
    const boxes: Box[] = [
      {
        x: space.sm,
        y: space.sm,
        width: LABEL_CONTROL_W,
        height: following ? MODE_CONTROL_H : MODE_CONTROL_H + LABEL_CONTROL_H,
      },
      {
        x: width - 2 - ATTRIBUTION_W - space.md,
        y: height - 2 - ATTRIBUTION_H - space.xs,
        width: ATTRIBUTION_W,
        height: ATTRIBUTION_H,
      },
    ];
    if (radar)
      boxes.push({
        x: width - 2 - space.sm - radar.width,
        y: space.sm,
        width: radar.width,
        height: radar.height,
      });
    return boxes;
  }, [width, height, radar, following]);
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
          centre={camera.centre}
          headingRad={camera.headingRad}
          visibleM={visibleM}
          band={placer.outline.length > 0 ? outlineUse.used : [line]}
          bandFaded={outlineUse.unused}
          lines={NO_LINES}
          ticks={NO_TICKS}
          dots={followDots}
          // The radar takes the top right corner; no whole-lap inset here.
          inset={NO_INSET}
          corners={NO_CORNERS}
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
      <View style={styles.control}>
        <Segment options={MODE_OPTIONS} value={mode} onChange={onMode} />
        {following ? null : (
          <Segment options={LABEL_OPTIONS} value={labels} onChange={onLabels} />
        )}
      </View>
      {following ? (
        <MapZoomButtons
          zoom={zoom}
          steps={MAP_ZOOMS.length}
          onZoom={z => onZoom(z as MapZoom)}
          bottom={ZOOM_BOTTOM}
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
  control: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    alignItems: 'flex-start',
    gap: space.xs,
  },
  radar: {position: 'absolute', top: space.sm, right: space.sm},
  credit: {position: 'absolute', right: space.md, bottom: space.xs},
});
