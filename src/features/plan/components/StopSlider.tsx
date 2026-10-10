import {useEffect, useRef, useState} from 'react';
import {PanResponder, Platform, StyleSheet, View} from 'react-native';

import {radius, size, space, useTheme} from '@/src/design';
import {Chip, Text} from '@/src/ui';

import {lapAt} from '../pitPlan';
import {lapName} from '../planCards';

/** react-native-web applies the selection of a drag to the page text: hold it off while dragging. */
function holdSelection(hold: boolean) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  document.body.style.userSelect = hold ? 'none' : '';
}

/**
 * One stop of the pit plan as a slider over its bounds, with a -1 and a +1 lap
 * stepper beside it (44 pt, so it works one-handed). The filled part of the
 * track is the window's safe end, the outlined part runs on to where the tank
 * is empty at the median use; the grey tick is the planned lap. The model
 * clamps every lap: this only reports the lap asked for.
 */
export function StopSlider({
  after,
  min,
  max,
  p90Max,
  plan,
  name,
  onChange,
}: {
  after: number;
  min: number;
  max: number;
  p90Max: number;
  plan: number;
  /** Spoken name, "Stop 1". */
  name: string;
  onChange: (lap: number) => void;
}) {
  const {color} = useTheme();
  const [trackW, setTrackW] = useState(0);
  // PanResponder reads its handlers once: keep the latest in a ref.
  const latest = useRef({trackW, min, max, onChange});
  useEffect(() => {
    latest.current = {trackW, min, max, onChange};
  });
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() => {
    const ask = (x: number) => {
      const l = latest.current;
      l.onChange(lapAt(x, l.trackW, l.min, l.max));
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: e => {
        holdSelection(true);
        ask(e.nativeEvent.locationX);
      },
      onPanResponderMove: e => ask(e.nativeEvent.locationX),
      onPanResponderRelease: () => holdSelection(false),
      onPanResponderTerminate: () => holdSelection(false),
    });
  });
  const span = Math.max(1, max - min);
  const xOf = (lap: number) => ((lap - min) / span) * trackW;
  return (
    <View style={styles.row}>
      <Chip label='−' minWidth={size.hit} onPress={() => onChange(after - 1)} />
      <View style={styles.slider}>
        <View
          accessibilityRole='adjustable'
          accessibilityLabel={`${name}: after ${lapName(after)}`}
          accessibilityValue={{min, max, now: after}}
          onLayout={e => setTrackW(e.nativeEvent.layout.width)}
          {...responder.panHandlers}
          style={styles.hit}>
          <View
            pointerEvents='none'
            style={[
              styles.track,
              {borderColor: color.lineStrong, backgroundColor: color.bg},
            ]}>
            <View
              style={[
                styles.safe,
                {
                  width: xOf(p90Max),
                  backgroundColor: color.accentTint,
                  borderColor: color.accent,
                },
              ]}
            />
            <View
              style={[
                styles.mark,
                {left: xOf(plan), backgroundColor: color.textMuted},
              ]}
            />
            <View
              style={[
                styles.handle,
                {
                  left: xOf(after) - size.sliderHandle / 2,
                  backgroundColor: color.accent,
                },
              ]}
            />
          </View>
        </View>
        <View style={styles.ends}>
          <Text variant='axis' tone='textMuted'>
            {lapName(min)}
          </Text>
          <Text variant='axis' tone='textFaint'>
            {lapName(Math.round((min + max) / 2))}
          </Text>
          <Text variant='axis' tone='textMuted'>
            {lapName(max)}
          </Text>
        </View>
      </View>
      <Chip label='+' minWidth={size.hit} onPress={() => onChange(after + 1)} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  slider: {flex: 1},
  hit: {height: size.hit, justifyContent: 'center'},
  track: {
    height: size.sliderTrack,
    borderWidth: 1,
    borderRadius: radius.sm,
    borderStyle: 'dashed',
  },
  safe: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRightWidth: 1,
  },
  mark: {position: 'absolute', top: 0, bottom: 0, width: 1},
  handle: {
    position: 'absolute',
    top: -space.sm,
    bottom: -space.sm,
    width: size.sliderHandle,
    borderRadius: radius.xs,
  },
  ends: {flexDirection: 'row', justifyContent: 'space-between'},
});
