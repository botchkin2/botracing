import {StyleSheet, View} from 'react-native';

import {space} from '@/src/design';
import {Text} from '@/src/ui';

import {type PerLapStrip} from '../perLapStrip';

/** The Plan's first line (thread 99, PLN): use per lap as the hero, its p90, the laps a tank and the litres a % beside it. */
export function PerLapStripView({strip}: {strip: PerLapStrip}) {
  return (
    <View style={styles.box}>
      <Text variant='label' tone='textMuted'>
        {`${strip.label} per lap`}
      </Text>
      <View style={styles.line}>
        <Text variant='dataHero'>{strip.value}</Text>
        <Text variant='dataSmall' tone='textMuted'>
          {strip.detail}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {gap: space.xs},
  line: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: space.md,
    rowGap: space.xxs,
  },
});
