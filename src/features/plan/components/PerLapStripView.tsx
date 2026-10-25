import {StyleSheet, View} from 'react-native';

import {space} from '@/src/design';
import {Text} from '@/src/ui';

import {type PerLapStrip} from '../perLapStrip';

/**
 * The Plan's first line (thread 99, PLN): use per lap as the hero and its
 * p90 beside it, then what the numbers stand on (`notes`: the laps and sessions, the VE ratio's source, the newest
 * session's drift).
 */
export function PerLapStripView({
  strip,
  notes,
}: {
  strip: PerLapStrip;
  notes: string[];
}) {
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
      {notes.map(n => (
        <Text key={n} variant='dataSmall' tone='textMuted'>
          {n}
        </Text>
      ))}
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
