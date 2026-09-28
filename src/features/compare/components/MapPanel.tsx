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
  const styled = <
    T extends {lapId: string; selIndex: number; highlighted: boolean},
  >(
    r: T,
  ) => {
    const {color: c, width: w, opacity} = lapStyle(r.selIndex, r.highlighted);
    return {key: r.lapId, color: c, width: w, opacity};
  };
  const f = map.follow;

  return (
    <View style={[styles.box, {backgroundColor: color.surface}]}>
      {mode === 'follow' ? (
        <FollowMap
          width={width}
          height={height}
          centre={f.centre}
          headingRad={f.headingRad}
          visibleM={f.visibleM}
          band={f.band}
          lines={f.lines.map(l => ({...styled(l), points: l.points}))}
          ticks={f.brakeTicks.map((t, i) => ({
            key: `${t.lapId}-${i}`,
            ends: t.ends,
            color: lapStyle(t.selIndex, t.highlighted).color,
          }))}
          dots={map.dots.map(d => ({
            key: d.lapId,
            at: d.at,
            color: lapStyle(d.selIndex, d.highlighted).color,
          }))}
          inset={f.inset}
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
