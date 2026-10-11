import {StyleSheet, View} from 'react-native';

import {space} from '@/src/design';
import {Text} from '@/src/ui';

import type {Fact} from '../model';

/**
 * The phone's head: Best and Median large, side by side, and under them one
 * line of the rest ("21 laps · 14 comparable"). Session facts, not the
 * selection's. The desktop keeps its row of facts.
 */
export function SessionHead({facts}: {facts: Fact[]}) {
  const hero = ['Best', 'Median']
    .map(label => facts.find(f => f.label === label))
    .filter((f): f is Fact => f != null);
  const rest = facts.filter(f => !hero.includes(f));
  const line = rest
    .map(f =>
      f.label === 'Laps'
        ? `${f.value} laps`
        : f.label === 'Comparable'
        ? `${f.value} comparable`
        : `${f.label} ${f.value}`,
    )
    .join(' \u00b7 ');
  return (
    <View style={styles.head}>
      <View style={styles.hero}>
        {hero.map(f => (
          <View key={f.label}>
            <Text variant='label' tone='textMuted'>
              {f.label}
            </Text>
            <Text variant='dataHero' tone={f.best ? 'best' : 'text'}>
              {f.value}
            </Text>
          </View>
        ))}
      </View>
      {line ? (
        <Text variant='dataSmall' tone='textMuted'>
          {line}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {gap: space.sm},
  hero: {flexDirection: 'row', gap: space.xxl, flexWrap: 'wrap'},
});
