import {Pressable, StyleSheet, View} from 'react-native';
import Svg, {Path, Rect} from 'react-native-svg';

import type {RaceLanes as RaceLanesModel} from '@/src/analysis/raceLanes';
import {RaceLanes} from '@/src/charts';
import {radius, size, space, useTheme} from '@/src/design';
import {Segment, Text} from '@/src/ui';

import {RACE_RATES, type RaceRate, STEP_S} from '../clock';

const ICON = 16;
// The phone's scrub strip: the five lanes over the whole session, 9 pt each
// (the same height as the phone's lanes block), no labels.
const STRIP_LANE_H = 9;

// ".25×" not "0.25×": seven rates have to fit a phone.
const rateLabel = (r: RaceRate) => `${r < 1 ? String(r).slice(1) : r}×`;

/** Phone only: a strip to seek with, and the steps and rate that go with it. */
export type PhoneSeek = {
  lanes: RaceLanesModel;
  playheadS: number;
  width: number;
  onScrub: (timeS: number) => void;
  /** Move the clock by this many seconds (negative steps back). */
  onStep: (deltaS: number) => void;
  /** The one rate chip cycles; the desktop's segmented rates do not fit. */
  onCycleRate: () => void;
};

/**
 * Play or pause, the rates 0.25x to 16x, and the race clock (handoff R1a).
 * On the phone the clock keeps its own width, the rate is one chip that
 * cycles, and a strip under the buttons seeks (thread 44 #1822).
 */
export function RaceTransport({
  playing,
  rate,
  clock,
  onToggle,
  onRate,
  phone,
}: {
  playing: boolean;
  rate: RaceRate;
  /** "21:23.4": race time, mono. */
  clock: string;
  onToggle: () => void;
  onRate: (rate: RaceRate) => void;
  phone?: PhoneSeek;
}) {
  const {color} = useTheme();
  const playButton = (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={playing ? 'Pause' : 'Play'}
      onPress={onToggle}
      style={[
        styles.play,
        phone && styles.playPhone,
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
  );
  if (!phone)
    return (
      <View style={[styles.bar, {borderColor: color.line}]}>
        {playButton}
        <Text variant='dataStrong' style={styles.clock}>
          {clock}
        </Text>
        <Segment
          options={RACE_RATES.map(r => ({
            value: String(r),
            label: rateLabel(r),
          }))}
          value={String(rate)}
          onChange={v => onRate(Number(v) as RaceRate)}
        />
      </View>
    );
  const stepButton = (deltaS: number) => (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`${
        deltaS < 0 ? 'Back' : 'Forward'
      } ${STEP_S} seconds`}
      onPress={() => phone.onStep(deltaS)}
      style={[styles.chip, {borderColor: color.line}]}>
      <Text variant='dataStrong'>{`${deltaS < 0 ? '−' : '+'}${STEP_S} s`}</Text>
    </Pressable>
  );
  return (
    <View style={[styles.phoneBar, {borderColor: color.line}]}>
      <View style={styles.phoneRow}>
        {playButton}
        {stepButton(-STEP_S)}
        {stepButton(STEP_S)}
        <Text variant='dataStrong' numberOfLines={1} style={styles.phoneClock}>
          {clock}
        </Text>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`Playback rate ${rateLabel(
            rate,
          )}, tap for the next`}
          onPress={phone.onCycleRate}
          style={[styles.chip, {borderColor: color.line}]}>
          <Text variant='dataStrong'>{rateLabel(rate)}</Text>
        </Pressable>
      </View>
      <RaceLanes
        lanes={phone.lanes}
        window={{fromS: 0, toS: phone.lanes.durationS}}
        playheadS={phone.playheadS}
        width={phone.width}
        laneHeight={STRIP_LANE_H}
        labelWidth={0}
        lapLabelEvery={1}
        onScrub={phone.onScrub}
        compact
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    rowGap: space.md,
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
  // 44 pt on the phone, like the step and rate buttons beside it.
  playPhone: {width: size.hit, height: size.hit},
  clock: {flex: 1},
  phoneBar: {
    paddingHorizontal: size.gutter,
    paddingVertical: space.md,
    gap: space.md,
    borderTopWidth: 1,
  },
  phoneRow: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  // Takes what the buttons leave and never wraps: "6:12.4" stays on one line.
  phoneClock: {flex: 1, textAlign: 'center'},
  chip: {
    minWidth: size.hit,
    height: size.hit,
    paddingHorizontal: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
  },
});
