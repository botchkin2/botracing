import {StyleSheet, View} from 'react-native';

import {type TimedGrid} from '@/src/analysis/window';
import {TrafficLane} from '@/src/charts';
import {size, space} from '@/src/design';
import {Text} from '@/src/ui';

import {type TrafficLaneModel} from '../model';
import {type LapStyle} from './ChartBlock';

export const NO_FIELD = 'No other cars recorded in this session';

/** The car-ahead lane under the last chart. */
export function TrafficLaneBlock({
  lane,
  width,
  windowM,
  timeAxis,
  cursorM,
  lapStyle,
}: {
  lane: TrafficLaneModel;
  width: number;
  windowM: [number, number];
  timeAxis?: {ref: TimedGrid; windowS: [number, number]} | null;
  cursorM: number;
  lapStyle: LapStyle;
}) {
  return (
    <View style={styles.block}>
      <Text variant='label' tone='textMuted'>
        Car ahead
      </Text>
      {lane.kind === 'empty' ? (
        <View style={styles.empty}>
          <Text variant='body' tone='textMuted'>
            {NO_FIELD}
          </Text>
        </View>
      ) : (
        <>
          <TrafficLane
            width={width}
            windowM={windowM}
            timeAxis={timeAxis}
            cursorM={cursorM}
            rows={lane.rows.map(r => ({
              ...r,
              key: r.lapId,
              color: lapStyle(r.selIndex, r.highlighted).color,
            }))}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {gap: space.xxs},
  empty: {height: size.trafficLaneEmpty, justifyContent: 'center'},
});
