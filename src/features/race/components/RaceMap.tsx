import {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {type MapCar, TrackMap} from '@/src/charts';
import {type MapPlacer} from '@/src/data/sessions';
import {radius, space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import {type RaceDot} from '../model';
import {classColor} from './classColor';

// Dot radii in points by class, from handoff R1d (desktop scale x1.15, phone
// x0.8); "other" classes take the GT3 size.
const RADIUS = {hypercar: 4.2, lmp2: 3.7, gt3: 3.2, other: 3.2};
const YOU_RADIUS = 4.6;
const PHONE_SCALE = 0.8;
const DESKTOP_SCALE = 1.15;

const NO_MARKS = {boundaries: [], sections: [], corners: []};

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
  line,
  dots,
  showCars,
  attribution,
  onPressCar,
}: {
  width: number;
  height: number;
  desktop: boolean;
  placer: MapPlacer;
  line: {x: number; y: number}[];
  dots: RaceDot[];
  /** False when the cars do not match the drawn track (see worldMatch). */
  showCars: boolean;
  attribution: string | null;
  onPressCar: (index: number) => void;
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
          }))
        : [],
    [showCars, dots, placed, color, scale],
  );
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
      <TrackMap
        width={width - 2}
        height={height - 2}
        outline={placer.outline}
        pitLane={placer.pitLane}
        lines={lines}
        dots={[]}
        marks={NO_MARKS}
        openSection={null}
        onPressSection={noop}
        cars={cars}
        onPressCar={key => onPressCar(Number(key))}
      />
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
  credit: {position: 'absolute', right: space.md, bottom: space.xs},
});
