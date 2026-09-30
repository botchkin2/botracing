import {StyleSheet, View} from 'react-native';

import {radius, space, useTheme} from '@/src/design';

import {Button} from './Button';
import {Text} from './Text';

/**
 * One line about a load: a waiting dot while it runs, a neutral idle dot when
 * it failed (never amber or red, round 3 R4c), and Retry when there is one.
 */
export function StatusBanner({
  text,
  dot,
  actionLabel,
  onAction,
}: {
  text: string;
  dot: 'waiting' | 'idle';
  actionLabel?: string;
  onAction?: () => void;
}) {
  const {color} = useTheme();
  return (
    <View
      style={[
        styles.banner,
        {backgroundColor: color.surfaceOverlay, borderColor: color.lineStrong},
      ]}>
      <View
        style={[
          styles.dot,
          {
            backgroundColor:
              dot === 'waiting' ? color.statusWaiting : color.statusIdle,
          },
        ]}
      />
      <Text variant='body' tone='textSecondary' style={styles.text}>
        {text}
      </Text>
      {actionLabel && onAction && (
        <Button label={actionLabel} kind='outline' onPress={onAction} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  dot: {width: 7, height: 7, borderRadius: 4, flexShrink: 0},
  text: {flex: 1},
});
