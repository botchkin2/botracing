import {StyleSheet, View} from 'react-native';

import {updateReady, useUploaders} from '@/src/data/uploaders';
import {space, useTheme} from '@/src/design';
import {Button, Text} from '@/src/ui';

/**
 * A slim line on top of every screen while a newer tray is downloaded and
 * waiting: "Tray 0.1.12 ready" with Restart inside the tray's own window
 * (`restart` is set there only), and "Tray 0.1.12 ready on the PC" anywhere
 * else: a phone cannot restart a PC. The words are `updateReady`'s; the same
 * row is in Settings.
 */
export function UpdateBanner({restart}: {restart: (() => unknown) | null}) {
  const {color} = useTheme();
  const uploaders = useUploaders();
  const ready = updateReady(
    uploaders.data,
    uploaders.dataUpdatedAt,
    restart != null,
  );
  if (!ready) return null;
  return (
    <View
      style={[
        styles.bar,
        {backgroundColor: color.surfaceOverlay, borderColor: color.lineStrong},
      ]}>
      <Text variant='body' tone='textSecondary' style={styles.text}>
        {ready.line}
      </Text>
      {restart && (
        <Button label='Restart' kind='outline' onPress={() => void restart()} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderBottomWidth: 1,
  },
  text: {flex: 1},
});
