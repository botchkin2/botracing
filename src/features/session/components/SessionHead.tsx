import {StyleSheet, View} from 'react-native';

import {space} from '@/src/design';
import {Text} from '@/src/ui';

import {type Fact, factLabel} from '../model';

/**
 * The phone's head: Best and Median large, side by side. The Median carries
 * its Spread under it, "Spread 2.35 s", the IQR of the same laps, so the first
 * screen answers how consistent the session was. Under them one line of the
 * rest ("21 laps · 14 comparable"). Best is the session's, Median is of the
 * selection and says how many laps. The desktop keeps its row of facts.
 */
export function SessionHead({facts}: {facts: Fact[]}) {
  const hero = ['Best', 'Median']
    .map(label => facts.find(f => f.label === label))
    .filter((f): f is Fact => f != null);
  const spread = facts.find(f => f.label === 'Spread');
  const rest = facts.filter(f => !hero.includes(f) && f !== spread);
  const line = rest
    .map(f =>
      f.label === 'Laps'
        ? `${f.value} laps`
        : f.label === 'Comparable'
        ? `${f.value} comparable`
        : `${f.label} ${f.value}`,
    )
    .join(' · ');
  return (
    <View style={styles.head}>
      <View style={styles.hero}>
        {hero.map(f => (
          <View key={f.label}>
            <Text variant='label' tone='textMuted'>
              {factLabel(f)}
            </Text>
            <Text variant='dataHero' tone={f.best ? 'best' : 'text'}>
              {f.value}
            </Text>
            {f.label === 'Median' && spread ? (
              <Text variant='dataStrong'>{`${spread.label} ${spread.value}`}</Text>
            ) : null}
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
