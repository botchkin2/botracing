import {StyleSheet, View} from 'react-native';

import {space} from '@/src/design';
import {Text} from '@/src/ui';

import type {OptimumLine} from '../optimumLines';

/** One line per stint under the lap-time chart: Optimal, Median, the gap, and "of N" ticked laps. */
export function OptimumLines({lines}: {lines: OptimumLine[]}) {
  return (
    <View style={styles.block}>
      {lines.map(l => (
        <Text
          key={l.label ?? 'session'}
          variant='dataSmall'
          tone='textSecondary'>
          {`${l.label ? `${l.label} \u00b7 ` : ''}Optimal ${
            l.optimal
          } \u00b7 Median ${l.median} \u00b7 ${l.inconsistency} \u00b7 ${l.of}`}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({block: {gap: space.xs}});
