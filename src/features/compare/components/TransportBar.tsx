import type {ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import Svg, {Path, Rect} from 'react-native-svg';

import {radius, size, space, useTheme} from '@/src/design';
import {type PlayRate, type WindowStep} from '@/src/state/comparePrefs';
import {nextRate} from '../playback';
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
  rewinding,
  rate,
  onMode,
  onStep,
  onLap,
  onPlay,
  onReverse,
  onBack,
  onForward,
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
  rewinding: boolean;
  rate: PlayRate;
  onMode: (m: WindowMode) => void;
  onStep: (dir: -1 | 1) => void;
  /** One tap to the whole lap. */
  onLap: () => void;
  onPlay: () => void;
  onReverse: () => void;
  /** One step back / forward along the lap. */
  onBack: () => void;
  onForward: () => void;
  onRate: (r: PlayRate) => void;
}) {
  const {color} = useTheme();
  // The 28 pt control's touch area grows to 44 pt on native (hitSlop); web ignores it.
  const HIT_SLOP = (size.hit - size.chip) / 2;
  const hit = {
    hitSlop: {top: HIT_SLOP, bottom: HIT_SLOP, left: HIT_SLOP, right: HIT_SLOP},
  };
  const stepper = (
    <View style={[styles.stepper, {borderColor: color.lineStrong}]}>
      <Pressable
        accessibilityLabel='Smaller window'
        onPress={() => onStep(-1)}
        disabled={step === 0}
        hitSlop={hit.hitSlop}
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
        hitSlop={hit.hitSlop}
        style={styles.stepBtn}>
        <Text variant='dataStrong' tone={step === 'lap' ? 'textFaint' : 'text'}>
          +
        </Text>
      </Pressable>
    </View>
  );
  const lapButton = (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel='Whole lap'
      onPress={onLap}
      disabled={step === 'lap'}
      hitSlop={hit.hitSlop}
      style={[styles.stepper, {borderColor: color.lineStrong}, styles.lapBtn]}>
      <Text variant='dataStrong' tone={step === 'lap' ? 'textFaint' : 'text'}>
        Lap
      </Text>
    </Pressable>
  );
  const windowRow = (
    <View style={styles.row}>
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
      {lapButton}
    </View>
  );
  // One round button per action; the glyph is the action.
  const round = (
    label: string,
    onPress: () => void,
    glyph: (fill: string) => ReactNode,
    primary: boolean,
  ) => (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      onPress={onPress}
      {...hitFor(
        (size.hit - size.transport) / 2,
        (size.hit - size.transport) / 2,
      )}>
      <View
        style={[
          styles.play,
          primary
            ? {backgroundColor: color.accent}
            : [styles.outlined, {borderColor: color.lineStrong}],
        ]}>
        <Svg width={14} height={14} viewBox='0 0 14 14'>
          {glyph(primary ? color.bg : color.text)}
        </Svg>
      </View>
    </Pressable>
  );
  const pauseGlyph = (fill: string) => (
    <>
      <Rect x={2} y={1} width={3.5} height={12} fill={fill} />
      <Rect x={8.5} y={1} width={3.5} height={12} fill={fill} />
    </>
  );
  const playRow = (
    <View style={styles.row}>
      {round(
        'Step back',
        onBack,
        f => (
          <>
            <Rect x={2} y={1} width={2} height={12} fill={f} />
            <Path d='M12 1 L4 7 L12 13 Z' fill={f} />
          </>
        ),
        false,
      )}
      {round(
        rewinding ? 'Pause' : 'Play reverse',
        onReverse,
        f =>
          rewinding ? pauseGlyph(f) : <Path d='M11 1 L1 7 L11 13 Z' fill={f} />,
        false,
      )}
      {round(
        playing ? 'Pause' : 'Play',
        onPlay,
        f =>
          playing ? pauseGlyph(f) : <Path d='M3 1 L13 7 L3 13 Z' fill={f} />,
        true,
      )}
      {round(
        'Step forward',
        onForward,
        f => (
          <>
            <Rect x={10} y={1} width={2} height={12} fill={f} />
            <Path d='M2 1 L10 7 L2 13 Z' fill={f} />
          </>
        ),
        false,
      )}
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={`Speed ${rate}×`}
        onPress={() => onRate(nextRate(rate))}
        hitSlop={HIT_SLOP}
        style={[
          styles.stepper,
          {borderColor: color.lineStrong},
          styles.lapBtn,
        ]}>
        <Text variant='dataStrong' style={styles.rateLabel}>
          {rate}×
        </Text>
      </Pressable>
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
  rateLabel: {minWidth: 36, textAlign: 'center'},
  lapBtn: {paddingHorizontal: space.md, justifyContent: 'center'},
  outlined: {borderWidth: 1},
  play: {
    width: size.transport,
    height: size.transport,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
