import {StyleSheet, View} from 'react-native';

import {space} from '@/src/design';
import {Text} from '@/src/ui';

import type {OptimumLine} from '../optimumLines';

/**
 * One line per stint under the lap-time chart: optimal, typical (the sum of the
 * section medians), the gap, and the laps. "Typical", not "Median", until the
 * selection-driven numbers land (#508): the head's MEDIAN is the lap-time median,
 * and one screen must not show two Medians.
 */
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
          } \u00b7 Typical ${l.median} \u00b7 ${l.inconsistency} \u00b7 ${
            l.laps
          }`}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({block: {gap: space.xs}});
