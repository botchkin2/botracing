import {type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {space} from '@/src/design';
import {Text} from '@/src/ui';

import {type LoadTable, type PlanView} from '../model';

import {PlanCard} from './PlanCard';

/** The Load to finish card as one table: a row per race length. */
export function LoadTableCard({table}: {table: LoadTable}) {
  return (
    <PlanCard title={table.title}>
      <View style={styles.tableRow}>
        {table.head.map((h, i) => (
          <Text
            key={i}
            variant='tableHeader'
            tone='textMuted'
            style={i === 0 ? styles.tableLabel : styles.tableCell}>
            {h}
          </Text>
        ))}
      </View>
      {table.rows.map(row => (
        <View key={row.label} style={styles.tableRow}>
          <Text variant='data' style={styles.tableLabel}>
            {row.label}
          </Text>
          <Text variant='data' tone='textSecondary' style={styles.tableCell}>
            {row.median}
          </Text>
          <Text variant='dataStrong' style={styles.tableCell}>
            {row.p90}
          </Text>
        </View>
      ))}
    </PlanCard>
  );
}

const styles = StyleSheet.create({
  tableRow: {flexDirection: 'row', gap: space.md},
  tableLabel: {flex: 1.1},
  tableCell: {flex: 1.4},
});
