import {StyleSheet, View} from 'react-native';

import {space, useTheme} from '@/src/design';
import {Button, Text} from '@/src/ui';

import {type PitPlan} from '../pitPlan';
import {
  finalStintWarning,
  finishLine,
  formationRow,
  stintRow,
} from '../pitPlanText';
import {stintLaps} from '../planCards';
import {type StripCell} from '../stintStrip';
import {type StopPanel} from '../stopPanels';
import {type Unit} from '../unit';
import {PlanCard} from './PlanCard';
import {StintStripView} from './StintStripView';
import {StopPanelView} from './StopPanelView';
import {StopSlider} from './StopSlider';

/**
 * The Pit plan (thread 99, PLN; the slider from thread 44 #1812): a panel per
 * stop with its slider and the level to set, the race's stints as a strip, and
 * on desktop the stint table with the exact numbers. Everything shown is
 * finished in `pitPlan`, `stopPanels` and `stintStrip`.
 */
export function PitPlanCard({
  pit,
  planned,
  panels,
  strip,
  stripLabel,
  limit = null,
  unit,
  wide = false,
  onStop,
  onReset,
}: {
  pit: PitPlan;
  /** Each stop's plan lap, drawn as a tick on its slider. */
  planned: number[];
  panels: StopPanel[];
  strip: StripCell[];
  stripLabel: string;
  /** Which meter runs out first, in words (planCards `tank.limit`); null with one meter. */
  limit?: string | null;
  unit: Unit;
  /** Desktop: the stops two to a row, and the stint table. */
  wide?: boolean;
  onStop: (stop: number, lap: number) => void;
  onReset: () => void;
}) {
  const finalWarning = finalStintWarning(pit);
  return (
    <PlanCard title='Pit plan'>
      <View style={styles.stops}>
        {pit.stops.map((s, i) =>
          panels[i] ? (
            <StopPanelView
              key={s.stop}
              panel={panels[i]}
              half={wide}
              slider={
                <StopSlider
                  after={s.after}
                  min={s.min}
                  max={s.max}
                  p90Max={s.p90Max}
                  plan={planned[s.stop - 1]}
                  name={`Stop ${s.stop}`}
                  onChange={lap => onStop(s.stop, lap)}
                />
              }
            />
          ) : null,
        )}
      </View>
      {limit ? (
        <Text variant='dataSmall' tone='textSecondary'>
          {limit}
        </Text>
      ) : null}
      <StintStripView cells={strip} label={stripLabel} />
      {wide ? <StintTable pit={pit} unit={unit} /> : null}
      <Text variant='dataSmall' tone='textSecondary'>
        {finishLine(pit)}
      </Text>
      {finalWarning ? (
        <Text variant='dataSmall' tone='slower'>
          {finalWarning}
        </Text>
      ) : null}
      {pit.moved ? (
        <View style={styles.reset}>
          <Button label='Reset to plan' kind='outline' onPress={onReset} />
        </View>
      ) : null}
    </PlanCard>
  );
}

/** Desktop's exact numbers: the formation, then each stint's laps, use and tyre laps. */
function StintTable({pit, unit}: {pit: PitPlan; unit: Unit}) {
  const {color} = useTheme();
  const headers = ['Stint', 'Laps', unit === 've' ? 'VE' : 'Fuel', 'Tire laps'];
  const counts = pit.stints.map(x => x.laps);
  const formation = formationRow(pit, unit);
  const rows = [
    ...(formation ? [{key: 'formation', ...formation}] : []),
    ...pit.stints.map((s, i) => ({
      key: `stint-${s.n}`,
      ...stintRow(s, unit, stintLaps(counts, i)),
    })),
  ];
  return (
    <View style={[styles.table, {borderColor: color.line}]}>
      <View style={styles.row}>
        {headers.map(h => (
          <Text
            key={h}
            variant='tableHeader'
            tone='textMuted'
            style={h === 'Stint' ? styles.name : styles.cell}>
            {h}
          </Text>
        ))}
      </View>
      {rows.map(r => (
        <View key={r.key} style={styles.row}>
          <Text variant='data' style={styles.name}>
            {r.label}
          </Text>
          <Text variant='data' style={styles.cell}>
            {r.laps}
          </Text>
          <Text variant='data' style={styles.cell}>
            {r.use}
          </Text>
          <Text variant='data' style={styles.cell}>
            {r.tyres}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stops: {flexDirection: 'row', flexWrap: 'wrap', gap: space.lg},
  table: {gap: space.xs, paddingTop: space.sm, borderTopWidth: 1},
  row: {flexDirection: 'row', gap: space.md},
  name: {flex: 1.2},
  cell: {flex: 1},
  reset: {alignItems: 'flex-start'},
});
