import {StyleSheet, View} from 'react-native';

import {space} from '@/src/design';
import {Text} from '@/src/ui';

import {TAG_KEY} from '../lapTags';

/** The tag legend: each code with its word, wrapped, not a sentence. */
export function TagKey() {
  return (
    <View style={styles.wrap}>
      {TAG_KEY.map(t => (
        <View key={t.code} style={styles.item}>
          <Text variant='dataSmall' tone='textSecondary'>
            {t.code}
          </Text>
          <Text variant='dataSmall' tone='textMuted'>
            {t.meaning}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md},
  item: {flexDirection: 'row', gap: space.xs},
});
