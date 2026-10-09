import {Pressable, StyleSheet, View} from 'react-native';
import Svg, {Path, Rect} from 'react-native-svg';

import {radius, size, space, useTheme} from '@/src/design';
import {
  PLAY_RATES,
  type PlayRate,
  type WindowStep,
} from '@/src/state/comparePrefs';
import {hitFor, Segment, Text} from '@/src/ui';

import {type WindowMode} from '@/src/analysis/window';

/**
 * Window and playback controls (handoff §3 "Transport bar"). Two rows on the
 * phone, one row on desktop.
 */
export function TransportBar({
  oneRow,
  mode,
  step,
  sizeLabel,
  spanLabel,
  playing,
  seekVisible,
  rate,
  onMode,
  onStep,
  onPlay,
  onRate,
}: {
  oneRow: boolean;
  mode: WindowMode;
  step: WindowStep;
  /** "2 s", "200 m" or "Lap". */
  sizeLabel: string;
  /** "≈ 87 m", "fixed" or "whole lap". */
  spanLabel: string;
  playing: boolean;
  /** The window and step row. Hidden rows keep their space and take no touches. */
  seekVisible: boolean;
  rate: PlayRate;
  onMode: (m: WindowMode) => void;
  onStep: (dir: -1 | 1) => void;
  onPlay: () => void;
  onRate: (r: PlayRate) => void;
}) {
  const {color} = useTheme();
  const stepper = (
    <View style={[styles.stepper, {borderColor: color.lineStrong}]}>
      <Pressable
        accessibilityLabel='Smaller window'
        onPress={() => onStep(-1)}
        disabled={step === 0}
        hitSlop={space.sm}
        style={styles.stepBtn}>
        <Text variant='dataStrong' tone={step === 0 ? 'textFaint' : 'text'}>
          −
        </Text>
      </Pressable>
      <Text variant='dataStrong' style={styles.stepLabel}>
        {sizeLabel}
      </Text>
      <Pressable
        accessibilityLabel='Larger window'
        onPress={() => onStep(1)}
        disabled={step === 'lap'}
        hitSlop={space.sm}
        style={styles.stepBtn}>
        <Text variant='dataStrong' tone={step === 'lap' ? 'textFaint' : 'text'}>
          +
        </Text>
      </Pressable>
    </View>
  );
  const windowRow = (
    <View
      style={[styles.row, !seekVisible && styles.faded]}
      pointerEvents={seekVisible ? 'auto' : 'none'}>
      <Text variant='label' tone='textMuted'>
        Window
      </Text>
      <Segment
        options={[
          {value: 'time', label: 'Time'},
          {value: 'distance', label: 'Distance'},
        ]}
        value={mode}
        onChange={onMode}
      />
      <Text variant='dataSmall' tone='textMuted' style={styles.flex}>
        {spanLabel}
      </Text>
      {stepper}
    </View>
  );
  const playRow = (
    <View style={styles.row}>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={playing ? 'Pause' : 'Play'}
        onPress={onPlay}
        {...hitFor(
          (size.hit - size.transport) / 2,
          (size.hit - size.transport) / 2,
        )}>
        <View style={[styles.play, {backgroundColor: color.accent}]}>
          <Svg width={14} height={14} viewBox='0 0 14 14'>
            {playing ? (
              <>
                <Rect x={2} y={1} width={3.5} height={12} fill={color.bg} />
                <Rect x={8.5} y={1} width={3.5} height={12} fill={color.bg} />
              </>
            ) : (
              <Path d='M3 1 L13 7 L3 13 Z' fill={color.bg} />
            )}
          </Svg>
        </View>
      </Pressable>
      <Segment
        options={PLAY_RATES.map(r => ({value: String(r), label: `${r}×`}))}
        value={String(rate)}
        onChange={v => onRate(Number(v) as PlayRate)}
      />
    </View>
  );
  return (
    <View
      style={[
        styles.bar,
        oneRow && styles.oneRow,
        {backgroundColor: color.surface, borderColor: color.lineHeader},
      ]}>
      {windowRow}
      {playRow}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    gap: space.sm,
    padding: space.md,
    borderTopWidth: 1,
  },
  oneRow: {flexDirection: 'row-reverse', justifyContent: 'space-between'},
  row: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  faded: {opacity: 0},
  flex: {flex: 1},
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.sm,
    height: size.chip,
  },
  stepBtn: {width: 28, alignItems: 'center', justifyContent: 'center'},
  stepLabel: {minWidth: 40, textAlign: 'center'},
  play: {
    width: size.transport,
    height: size.transport,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
