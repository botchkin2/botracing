import {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {FollowMap, TrackMap} from '@/src/charts';
import {radius, space, useTheme} from '@/src/design';
import {type MapMode} from '@/src/state/comparePrefs';
import {Segment, Text} from '@/src/ui';

import {type MapModel} from '../model';
import {type LapStyle} from './ChartBlock';

// The Compare map panel (handoff v2 M1): Follow / Track switch over the map,
// the position label in Follow, and OSM attribution when OSM is drawn.
// Satellite is not shown until it ships.

const MODES = [
  {value: 'follow', label: 'Follow'},
  {value: 'track', label: 'Track'},
] as const;

export function MapPanel({
  width,
  height,
  map,
  mode,
  onMode,
  place,
  lapStyle,
  onPressBadge,
}: {
  width: number;
  height: number;
  map: MapModel;
  mode: MapMode;
  onMode: (mode: MapMode) => void;
  /** "Section 4", from the position row. */
  place: string;
  lapStyle: LapStyle;
  onPressBadge: (n: number) => void;
}) {
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
          visibleM={f.visibleM}
          band={f.geometry.band}
          lines={followLines}
          ticks={followTicks}
          dots={map.dots.map(d => ({
            key: d.lapId,
            at: d.at,
            color: lapStyle(d.selIndex, d.highlighted).color,
          }))}
          inset={f.geometry.inset}
        />
      ) : (
        <TrackMap
          width={width}
          height={height}
          outline={map.outline}
          lines={map.lines.map(l => ({...styled(l), points: l.points}))}
          dots={map.dots.map(d => ({
            key: d.lapId,
            at: d.at,
            color: lapStyle(d.selIndex, d.highlighted).color,
          }))}
          badges={map.badges}
          onPressBadge={onPressBadge}
        />
      )}
      <View style={styles.topLeft} pointerEvents='box-none'>
        <Segment options={MODES} value={mode} onChange={onMode} />
        {mode === 'follow' && place !== '' && (
          <View style={[styles.label, {backgroundColor: color.surfaceOverlay}]}>
            <Text variant='dataSmall' tone='textSecondary'>
              {place}
            </Text>
          </View>
        )}
      </View>
      {map.attribution && (
        <Text variant='dataSmall' tone='textFaint' style={styles.attribution}>
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
});
