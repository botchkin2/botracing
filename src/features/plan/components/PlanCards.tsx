import {type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {space} from '@/src/design';
import {Text} from '@/src/ui';

import {type LoadTable, type PlanView} from '../model';

import {PlanCard} from './PlanCard';

/** Two cards side by side on a wide screen, stacked on the phone. */
export function Pair({wide, children}: {wide: boolean; children: ReactNode[]}) {
  const cards = children.filter(Boolean);
  if (!wide || cards.length < 2) return <>{cards}</>;
  return (
    <View style={styles.pair}>
      {cards.map((c, i) => (
        <View key={i} style={styles.half}>
          {c}
        </View>
      ))}
    </View>
  );
}

/** A card of label / value / note rows, as `planView` gives them. */
export function RowsCard({card}: {card: PlanView['cards'][number]}) {
  return (
    <PlanCard title={card.title}>
      {card.rows.map((row, i) => (
        <View key={i} style={styles.rowBox}>
          <Text variant='label' tone='textMuted'>
            {row.label}
          </Text>
          <Text variant='data'>{row.value}</Text>
          {row.note ? (
            <Text variant='dataSmall' tone='textMuted'>
              {row.note}
            </Text>
          ) : null}
        </View>
      ))}
    </PlanCard>
  );
}

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
  pair: {flexDirection: 'row', gap: space.xl, alignItems: 'flex-start'},
  half: {flex: 1, minWidth: 0},
  rowBox: {gap: space.xs},
});
