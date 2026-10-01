import {StyleSheet, View} from 'react-native';

import {
  type LaneZoom,
  laneWindow,
  lapLabelEvery,
  type RaceLanes as RaceLanesModel,
} from '@/src/analysis/raceLanes';
import {RaceLanes} from '@/src/charts';
import {space} from '@/src/design';
import {Segment, Text} from '@/src/ui';

import {clockLabel} from '../clock';
import type {RaceMode} from '../model';

// YOUR RACE (handoff R1a/R1b): the label, the race clock and the zoom above the
// lanes; the window's start and end times under them. Lanes are 9 pt high in a
// 44 pt label column on the phone, 12 pt in 56 on desktop.
const PHONE = {laneHeight: 9, labelWidth: 44};
const DESKTOP = {laneHeight: 12, labelWidth: 56};

// The whole-window zoom is named for what the session is: outside a race
// there is no race to show (production QA, thread 44 #1723).
const zooms = (mode: RaceMode) =>
  [
    {value: 'race', label: mode === 'race' ? 'Race' : 'Session'},
    {value: 'l10', label: '10 laps'},
    {value: 'l3', label: '3 laps'},
  ] as const;

export function RaceLanesBlock({
  lanes,
  zoom,
  onZoom,
  playheadS,
  width,
  desktop,
  onScrub,
  mode,
}: {
  lanes: RaceLanesModel;
  zoom: LaneZoom;
  onZoom: (zoom: LaneZoom) => void;
  playheadS: number;
  width: number;
  desktop: boolean;
  onScrub: (timeS: number) => void;
  mode: RaceMode;
}) {
  const window = laneWindow(zoom, playheadS, lanes);
  const {laneHeight, labelWidth} = desktop ? DESKTOP : PHONE;
  return (
    <View style={styles.block}>
      <View style={styles.head}>
        <Text variant='label' tone='textMuted'>
          {mode === 'race' ? 'Your race' : 'Your session'}
        </Text>
        <Text variant='dataStrong' style={styles.clock}>
          {clockLabel(playheadS)}
        </Text>
        <Segment options={zooms(mode)} value={zoom} onChange={onZoom} />
      </View>
      <RaceLanes
        lanes={lanes}
        window={window}
        playheadS={playheadS}
        width={width}
        laneHeight={laneHeight}
        labelWidth={labelWidth}
        lapLabelEvery={lapLabelEvery(zoom)}
        onScrub={onScrub}
      />
      <View style={[styles.times, {paddingLeft: labelWidth}]}>
        <Text variant='axis' tone='textFaint'>
          {clockLabel(window.fromS)}
        </Text>
        <Text variant='axis' tone='textFaint'>
          {clockLabel(window.toS)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {gap: space.sm},
  head: {flexDirection: 'row', alignItems: 'center', gap: space.lg},
  clock: {flex: 1},
  times: {flexDirection: 'row', justifyContent: 'space-between'},
});
