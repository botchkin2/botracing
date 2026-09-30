import {useMemo} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {FollowMap, TrackMap} from '@/src/charts';
import {radius, space, useTheme} from '@/src/design';
import {
  MAP_ZOOMS,
  type MapZoom,
  useComparePrefs,
} from '@/src/state/comparePrefs';
import {MAP_ZOOM_BUTTONS_W, MapZoomButtons, Segment, Text} from '@/src/ui';

import {type MapModel} from '../model';
import {type LapStyle} from './ChartBlock';

// The Compare map panel (handoff v2 M1): Follow / Track switch over the map,
// the position label in Follow, the outline quality chip, OSM attribution
// when OSM is drawn, and a one-time note when there is no reliable outline.
// Satellite is not shown until it ships. The panel reads and writes the
// map prefs (mode, dismissed notes) itself, so both Compare layouts share them.

// Copy from the handoff, verbatim.
const POOR_NOTE =
  'No reliable track outline for this layout, so this shows your driven line instead. Laps line up by distance, not by position on the track.';

const MODES = [
  {value: 'follow', label: 'Follow'},
  {value: 'track', label: 'Track'},
] as const;

export function MapPanel({
  width,
  height,
  map,
  sessionId,
  openSection,
  lapStyle,
  onPressSection,
  zoomControls = false,
  baseSpanM,
}: {
  width: number;
  height: number;
  map: MapModel;
  sessionId: string;
  openSection: number | null;
  lapStyle: LapStyle;
  onPressSection: (n: number) => void;
  /** − / + on the Follow map: desktop only, where they can be pointer targets. */
  zoomControls?: boolean;
  /** Follow's visible span at zoom 1x, in metres; else it follows the chart window. */
  baseSpanM?: number;
}) {
  const prefs = useComparePrefs();
  const mode = prefs.mapMode;
  // A stored zoom outside the steps (a hand-edited or old save) reads as 1×.
  const zoom: MapZoom =
    MAP_ZOOMS[prefs.mapZoom] === undefined ? 1 : prefs.mapZoom;
  const noteShown = !map.realMap && !prefs.poorMapNoteSeen.includes(sessionId);
  const {color} = useTheme();
  const styled = (r: {
    lapId: string;
    selIndex: number;
    highlighted: boolean;
  }) => {
    const {color: c, width: w, opacity} = lapStyle(r.selIndex, r.highlighted);
    return {key: r.lapId, color: c, width: w, opacity};
  };
  const f = map.follow;
  const geometry = f?.geometry;

  // map.lines is rebuilt on every cursor move; its shown laps and their
  // styles only change with the selection. Key the Follow layers on that, so
  // their paths are not rebuilt per playback frame.
  const shownKey = map.lines
    .map(l => `${l.lapId}:${l.selIndex}:${l.highlighted ? 1 : 0}`)
    .join(',');
  const followLines = useMemo(
    () =>
      geometry
        ? map.lines.flatMap(l => {
            const points = geometry.lines.get(l.lapId);
            return points ? [{...styled(l), points}] : [];
          })
        : [],
    [geometry, shownKey, lapStyle],
  );
  const followTicks = useMemo(
    () =>
      geometry
        ? map.dots.flatMap(d => {
            const ticks = geometry.brakeTicks.get(d.lapId);
            return ticks
              ? [
                  {
                    key: d.lapId,
                    ticks,
                    color: lapStyle(d.selIndex, d.highlighted).color,
                  },
                ]
              : [];
          })
        : [],
    [geometry, shownKey, lapStyle],
  );

  return (
    <View style={[styles.box, {backgroundColor: color.surface}]}>
      {mode === 'follow' && f ? (
        <FollowMap
          width={width}
          height={height}
          centre={f.centre}
          headingRad={f.headingRad}
          visibleM={(baseSpanM ?? f.visibleM) * MAP_ZOOMS[zoom]}
          band={f.geometry.band}
          bandFaded={f.geometry.bandFaded}
          lines={followLines}
          ticks={followTicks}
          dots={map.dots.map(d => ({
            key: d.lapId,
            at: d.at,
            color: lapStyle(d.selIndex, d.highlighted).color,
          }))}
          inset={f.geometry.inset}
          corners={f.geometry.corners}
          scaleX={
            zoomControls
              ? MAP_ZOOM_BUTTONS_W + 2 * space.xs + space.sm
              : undefined
          }
        />
      ) : (
        <TrackMap
          width={width}
          height={height}
          outline={map.outline}
          outlineFaded={map.outlineFaded}
          pitLane={map.pitLane}
          lines={map.lines.map(l => ({...styled(l), points: l.points}))}
          dots={map.dots.map(d => ({
            key: d.lapId,
            at: d.at,
            color: lapStyle(d.selIndex, d.highlighted).color,
          }))}
          marks={map.marks}
          openSection={openSection}
          onPressSection={onPressSection}
        />
      )}
      <View style={styles.topLeft} pointerEvents='box-none'>
        <Segment options={MODES} value={mode} onChange={prefs.setMapMode} />
        {mode === 'follow' && map.followPlace !== '' && (
          <View style={[styles.label, {backgroundColor: color.surfaceOverlay}]}>
            <Text variant='dataSmall' tone='textSecondary'>
              {map.followPlace}
            </Text>
          </View>
        )}
      </View>
      {zoomControls && mode === 'follow' && f && (
        <MapZoomButtons
          canOut={zoom < MAP_ZOOMS.length - 1}
          canIn={zoom > 0}
          onOut={() => prefs.setMapZoom((zoom + 1) as MapZoom)}
          onIn={() => prefs.setMapZoom((zoom - 1) as MapZoom)}
        />
      )}
      {/* Track only: Follow has its inset in this corner. */}
      {mode === 'track' && (
        <View
          style={[
            styles.chip,
            {
              borderColor: color.lineStrong,
              backgroundColor: color.surfaceOverlay,
            },
          ]}>
          <Text variant='dataSmall' tone='textMuted'>
            {map.realMap ? 'OSM outline · good' : 'Driven line'}
          </Text>
        </View>
      )}
      {noteShown && (
        <Pressable
          accessibilityRole='button'
          accessibilityHint='Dismisses this note'
          onPress={() => prefs.dismissPoorMapNote(sessionId)}
          style={[
            styles.note,
            {
              borderColor: color.lineStrong,
              backgroundColor: color.surfaceOverlay,
            },
          ]}>
          <Text variant='body' tone='textSecondary'>
            {POOR_NOTE}
          </Text>
        </Pressable>
      )}
      {map.attribution && (
        <Text variant='attribution' tone='textFaint' style={styles.attribution}>
          {map.attribution}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {borderRadius: radius.md, overflow: 'hidden'},
  topLeft: {
    position: 'absolute',
    left: space.xs,
    top: space.xs,
    alignItems: 'flex-start',
    gap: space.xs,
  },
  label: {
    borderRadius: radius.sm,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
  },
  attribution: {position: 'absolute', right: space.xs, bottom: space.xxs},
  chip: {
    position: 'absolute',
    right: space.md,
    top: space.md,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
  },
  note: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.md,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: space.md,
  },
});
