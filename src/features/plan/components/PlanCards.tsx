import {type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {space} from '@/src/design';
import {Text} from '@/src/ui';

import {type PlanView} from '../model';

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

const styles = StyleSheet.create({
  pair: {flexDirection: 'row', gap: space.xl, alignItems: 'flex-start'},
  half: {flex: 1, minWidth: 0},
  rowBox: {gap: space.xs},
});
