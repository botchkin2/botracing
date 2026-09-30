import {Pressable, StyleSheet, View} from 'react-native';
import Svg, {Path, Rect} from 'react-native-svg';

import {radius, size, space, useTheme} from '@/src/design';
import {PLAY_RATES, type PlayRate} from '@/src/state/comparePrefs';
import {Segment, Text} from '@/src/ui';

const ICON = 16;

/** Play or pause, the rates 0.25x to 2x, and the race clock (handoff R1a). */
export function RaceTransport({
  playing,
  rate,
  clock,
  onToggle,
  onRate,
}: {
  playing: boolean;
  rate: PlayRate;
  /** "21:23.4": race time, mono. */
  clock: string;
  onToggle: () => void;
  onRate: (rate: PlayRate) => void;
}) {
  const {color} = useTheme();
  return (
    <View style={[styles.bar, {borderColor: color.line}]}>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={playing ? 'Pause' : 'Play'}
        onPress={onToggle}
        style={[
          styles.play,
          {backgroundColor: color.accent, borderRadius: radius.md},
        ]}>
        <Svg width={ICON} height={ICON} viewBox='0 0 16 16'>
          {playing ? (
            <>
              <Rect x={3} y={2} width={3.5} height={12} fill={color.bg} />
              <Rect x={9.5} y={2} width={3.5} height={12} fill={color.bg} />
            </>
          ) : (
            <Path d='M4 2 L14 8 L4 14 Z' fill={color.bg} />
          )}
        </Svg>
      </Pressable>
      <Text variant='dataStrong' style={styles.clock}>
        {clock}
      </Text>
      <Segment
        options={PLAY_RATES.map(r => ({value: String(r), label: `${r}×`}))}
        value={String(rate)}
        onChange={v => onRate(Number(v) as PlayRate)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: size.gutter,
    paddingVertical: space.md,
    borderTopWidth: 1,
  },
  play: {
    width: size.transport,
    height: size.transport,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clock: {flex: 1},
});
