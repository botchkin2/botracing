import {StyleSheet, View} from 'react-native';

import {space} from '@/src/design';
import {Text} from '@/src/ui';

import {type RaceCard} from '../planCards';

/**
 * The Race card (round 5, frame 1): how many laps, how many stops and where,
 * then the arithmetic behind the lap count. The stop laps are the full-tank
 * strategy, in the app's lap names.
 */
export function RaceCardView({card}: {card: RaceCard}) {
  return (
    <View style={styles.box}>
      <View style={styles.big}>
        <View>
          <Text variant='title'>{card.laps ?? '—'}</Text>
          <Text variant='dataSmall' tone='textMuted'>
            {card.laps === 1 ? 'lap' : 'laps'}
          </Text>
        </View>
        <View>
          <Text variant='title'>{card.stops ?? '—'}</Text>
          <Text variant='dataSmall' tone='textMuted'>
            {card.stops === 1 ? 'stop' : 'stops'}
          </Text>
        </View>
        {card.stopAfter.length > 0 ? (
          <View style={styles.after}>
            <Text variant='dataStrong'>{`after ${card.stopAfter.join(
              ', ',
            )}`}</Text>
            <Text variant='dataSmall' tone='textMuted'>
              full-tank strategy
            </Text>
          </View>
        ) : null}
      </View>
      {card.working ? (
        <Text variant='dataSmall' tone='textSecondary'>
          {card.working}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {gap: space.md},
  big: {flexDirection: 'row', alignItems: 'flex-end', gap: space.xxl},
  after: {flex: 1, alignItems: 'flex-end'},
});
