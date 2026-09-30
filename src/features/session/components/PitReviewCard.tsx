import {StyleSheet, View} from 'react-native';

import {space, useTheme} from '@/src/design';
import {Explainer, Text} from '@/src/ui';

import {type PitReview} from '../pitReview';

/**
 * The race pit review: one block per stop, then the end of the race. Each
 * line is short enough to wrap at 375 pt; no columns, so nothing scrolls
 * sideways.
 */
export function PitReviewCard({review}: {review: PitReview}) {
  const {color} = useTheme();
  const block = (key: string, title: string, lines: string[]) => (
    <View key={key} style={[styles.block, {borderColor: color.line}]}>
      <Text variant='bodyStrong'>{title}</Text>
      {lines.map(line => (
        <Text key={line} variant='dataSmall' tone='textSecondary'>
          {line}
        </Text>
      ))}
    </View>
  );
  return (
    <View style={styles.card}>
      <Text variant='label'>Pit stops</Text>
      <Explainer>{review.explainer}</Explainer>
      {review.stops.map(s => block(s.key, s.title, s.lines))}
      {review.end && block('end', review.end.title, review.end.lines)}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {gap: space.xs},
  block: {
    gap: space.xxs,
    paddingVertical: space.md,
    borderTopWidth: 1,
  },
});
