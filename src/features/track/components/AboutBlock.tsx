import {Linking, Pressable, StyleSheet, View} from 'react-native';

import {size, space} from '@/src/design';
import {Text} from '@/src/ui';

// About (handoff T1/05): the Wikipedia lead, with its CC BY-SA 4.0 credit
// and link always visible under the text. The licence requires it.
export function AboutBlock({
  about,
}: {
  about: {text: string; url: string; attribution: string};
}) {
  return (
    <View>
      <Text variant='label'>About</Text>
      <Text variant='body' tone='textSecondary' style={styles.text}>
        {about.text}
      </Text>
      <View style={styles.credit}>
        <Text variant='explainer' tone='textFaint'>
          From {about.attribution.replace(', ', ' · ')}
        </Text>
        <Pressable
          accessibilityRole='link'
          onPress={() => Linking.openURL(about.url)}
          hitSlop={space.md}>
          <Text variant='body' tone='accentInk'>
            Read more →
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  text: {marginTop: space.sm},
  credit: {
    minHeight: size.hit,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
