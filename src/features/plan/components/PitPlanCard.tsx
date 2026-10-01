import {StyleSheet, View} from 'react-native';

import {space, useTheme} from '@/src/design';
import {Button, Text} from '@/src/ui';

import {type PitPlan} from '../pitPlan';
import {lapName} from '../planCards';
import {
  finishLine,
  PIT_PLAN_EXPLAINER,
  stintRow,
  stopLine,
  stopWarning,
} from '../pitPlanText';

import {PlanCard} from './PlanCard';
import {StopSlider} from './StopSlider';

const HEADERS = ['Stint', 'Laps', 'Fuel', 'VE', 'Tyre laps'];

/**
 * The pit-lap slider (pit-wall thread 44 #1812): each stop of the plan over
 * its window, then the stints those stops make. `planned` is each stop's plan
 * lap, drawn as a tick. Everything shown is finished in `pitPlan`.
 */
export function PitPlanCard({
  pit,
  planned,
  onStop,
  onReset,
}: {
  pit: PitPlan;
  planned: number[];
  onStop: (stop: number, lap: number) => void;
  onReset: () => void;
}) {
  const {color} = useTheme();
  const showVe = pit.stints.some(s => s.vePct);
  return (
    <PlanCard title='Pit plan' explainer={PIT_PLAN_EXPLAINER}>
      {pit.stops.map(s => {
        const warning = stopWarning(s);
        return (
          <View key={s.stop} style={styles.stop}>
            <View style={styles.head}>
              <Text variant='label' tone='textMuted'>
                {`Stop ${s.stop}`}
              </Text>
              <Text variant='dataStrong'>{`after ${lapName(s.after)}`}</Text>
            </View>
            <StopSlider
              after={s.after}
              min={s.min}
              max={s.max}
              p90Max={s.p90Max}
              plan={planned[s.stop - 1]}
              name={`Stop ${s.stop}`}
              onChange={lap => onStop(s.stop, lap)}
            />
            <Text variant='dataSmall' tone='textSecondary'>
              {stopLine(s)}
            </Text>
            {warning ? (
              <Text variant='dataSmall' tone='textSecondary'>
                {warning}
              </Text>
            ) : null}
          </View>
        );
      })}
      <View style={[styles.table, {borderColor: color.line}]}>
        <View style={styles.row}>
          {HEADERS.filter(h => h !== 'VE' || showVe).map(h => (
            <Text
              key={h}
              variant='tableHeader'
              tone='textMuted'
              style={h === 'Stint' ? styles.name : styles.cell}>
              {h}
            </Text>
          ))}
        </View>
        {pit.stints.map(s => {
          const r = stintRow(s);
          return (
            <View key={s.n} style={styles.row}>
              <Text variant='data' style={styles.name}>
                {r.label}
              </Text>
              <Text variant='data' style={styles.cell}>
                {r.laps}
              </Text>
              <Text variant='data' style={styles.cell}>
                {r.fuel}
              </Text>
              {showVe ? (
                <Text variant='data' style={styles.cell}>
                  {r.ve}
                </Text>
              ) : null}
              <Text variant='data' style={styles.cell}>
                {r.tyres}
              </Text>
            </View>
          );
        })}
      </View>
      <Text variant='dataSmall' tone='textSecondary'>
        {finishLine(pit)}
      </Text>
      {pit.moved ? (
        <View style={styles.reset}>
          <Button label='Reset to plan' kind='outline' onPress={onReset} />
        </View>
      ) : null}
    </PlanCard>
  );
}

const styles = StyleSheet.create({
  stop: {gap: space.xxs},
  head: {flexDirection: 'row', justifyContent: 'space-between'},
  table: {gap: space.xs, paddingTop: space.sm, borderTopWidth: 1},
  row: {flexDirection: 'row', gap: space.md},
  name: {flex: 1.2},
  cell: {flex: 1},
  reset: {alignItems: 'flex-start'},
});
