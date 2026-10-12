import type {ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';
import Svg, {Path, Rect} from 'react-native-svg';

import {radius, size, space, useTheme} from '@/src/design';
import {type PlayRate, type WindowStep} from '@/src/state/comparePrefs';
import {nextRate} from '../playback';
import {hitFor, Pressable, Segment, Text} from '@/src/ui';

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
  looping,
  rate,
  onMode,
  onStep,
  onLap,
  onPlay,
  onReverse,
  onLoop,
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
  /** Playback repeats the window (or the whole lap) instead of stopping. */
  looping: boolean;
  rate: PlayRate;
  onMode: (m: WindowMode) => void;
  onStep: (dir: -1 | 1) => void;
  /** One tap to the whole lap. */
  onLap: () => void;
  onPlay: () => void;
  onReverse: () => void;
  onLoop: () => void;
  /** One step back / forward along the lap. */
  onBack: () => void;
  onForward: () => void;
  onRate: (r: PlayRate) => void;
}) {
  const {color} = useTheme();
  // The 28 pt control's touch area grows to 44 pt on native (hitSlop); web ignores it.
  const HIT_SLOP = (size.hit - size.chip) / 2;
  const STEP_SLOP_Y = (size.hit - size.chip) / 2;
  // The stepper's buttons are 28 x 28 pt: 8 pt each side, so each is a 44 pt
  // target.
  const hit = {
    hitSlop: {
      top: STEP_SLOP_Y,
      bottom: STEP_SLOP_Y,
      left: HIT_SLOP,
      right: HIT_SLOP,
    },
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
      {/* The span only where it has room: squeezed into the phone row it wrapped
          to three lines and made the row taller in Time than in Distance. */}
      {oneRow ? (
        <Text variant='dataSmall' tone='textMuted' style={styles.flex}>
          {spanLabel}
        </Text>
      ) : (
        <View style={styles.flex} />
      )}
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
    selected?: boolean,
  ) => (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : {selected}}
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
            : [
                styles.outlined,
                {borderColor: selected ? color.accent : color.lineStrong},
              ],
        ]}>
        <Svg width={14} height={14} viewBox='0 0 14 14'>
          {glyph(primary ? color.bg : selected ? color.accent : color.text)}
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
        'Loop',
        onLoop,
        f => (
          <Path
            d='M2 7 Q2 3 6 3 H11 M9 1 L11 3 L9 5 M12 7 Q12 11 8 11 H3 M5 9 L3 11 L5 13'
            stroke={f}
            strokeWidth={1.6}
            fill='none'
          />
        ),
        false,
        looping,
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
  // The full height of the 28 pt stepper, so the slop reaches 44.
  stepBtn: {
    width: 28,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Wide enough for "200 m", so the buttons beside it stay put between Time and Distance.
  stepLabel: {minWidth: 56, textAlign: 'center'},
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
