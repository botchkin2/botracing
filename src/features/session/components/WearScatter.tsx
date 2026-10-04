import {StyleSheet, View} from 'react-native';

import {FuelScatter} from '@/src/charts';
import {space} from '@/src/design';
import {Text} from '@/src/ui';

import {type WearScatterModel} from '../wearScatter';

const PANEL_H = 150;

/**
 * Lap time and wear (round 7 1A): one small scatter per fuel band, the same
 * axes on each, a dashed least-squares line where the laps allow one.
 */
export function WearScatter({
  model,
  width,
}: {
  model: WearScatterModel;
  width: number;
}) {
  return (
    <View style={styles.box}>
      <Text variant='label'>Lap time and wear</Text>
      <Text variant='dataSmall' tone='textSecondary'>
        {model.headline}
      </Text>
      {model.panels.map(p => (
        <View key={p.label} style={styles.panel}>
          <Text variant='dataSmall' tone='textSecondary'>
            {p.label}
          </Text>
          <FuelScatter
            width={width}
            height={PANEL_H}
            points={p.points}
            xDomain={model.xDomain}
            yDomain={model.yDomain}
            xTicks={model.xTicks}
            yTicks={model.yTicks}
            xTitle='Tyre wear lost, % (mean of four wheels)'
            yTitle='Lap time'
            fit={p.fit}
          />
          <Text variant='dataSmall' tone='textMuted'>
            {p.note}
          </Text>
        </View>
      ))}
      <Text variant='dataSmall' tone='textMuted'>
        {model.flagged == null
          ? `${model.n} green laps`
          : `${model.n} green laps · ${model.flagged} with tow, traffic or blue flag`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {gap: space.md},
  panel: {gap: space.xs},
});
