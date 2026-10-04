import {StyleSheet, View} from 'react-native';

import {space} from '@/src/design';

import {Text} from './Text';

/** A title and one line of why there is nothing here (round 3 R4c). Neutral. */
export function EmptyState({title, body}: {title: string; body?: string}) {
  return (
    <View style={styles.box}>
      <Text variant='bodyStrong' style={styles.text}>
        {title}
      </Text>
      {body ? (
        <Text variant='body' tone='textMuted' style={styles.text}>
          {body}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {alignItems: 'center', gap: space.sm, padding: space.xl},
  text: {textAlign: 'center'},
});
