import {StyleSheet, View} from 'react-native';

import {updateReady, useUploaders} from '@/src/data/uploaders';
import {space, useTheme} from '@/src/design';
import {Button, Text} from '@/src/ui';

/** The banner's words around the version, which is set in bold: ["Update ", "0.1.12", " ready"]. */
export function bannerParts(ready: {line: string; version: string}): [string, string, string] {
  const at = ready.line.indexOf(ready.version);
  return [ready.line.slice(0, at), ready.version, ready.line.slice(at + ready.version.length)];
}

/**
 * A slim line on top of every screen while a newer tray is downloaded and
 * waiting: "Update 0.1.12 ready" with Restart inside the tray's own window
 * (`restart` is set there only), and "Update 0.1.12 ready on the PC" anywhere
 * else: a phone cannot restart a PC. The words are `updateReady`'s; the same
 * row is in Settings. It reads as a banner (ticket 22, Botkin: "I expect a banner
 * if there is a version update, small but understandable"): an accent edge on a
 * tint, the text in the primary tone and the version in bold. Not dismissible: it
 * goes when the tray installs.
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
  const [before, version, after] = bannerParts(ready);
  return (
    <View
      accessibilityRole='alert'
      style={[
        styles.bar,
        {
          backgroundColor: color.accentTint,
          borderColor: color.accent,
        },
      ]}>
      <Text variant='body' style={styles.text}>
        {before}
        <Text variant='bodyStrong'>{version}</Text>
        {after}
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
    borderLeftWidth: 4,
  },
  text: {flex: 1},
});
