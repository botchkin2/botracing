import {useEffect} from 'react';
import {StyleSheet, View} from 'react-native';

import {space, useTheme} from '@/src/design';

import {Button} from './Button';
import {Text} from './Text';

/**
 * What a route shows when it threw while rendering, in place of a blank
 * window. The error is logged with the route's name: the app has no error
 * reporter, so this line is what a developer with the device sees.
 */
export function ErrorScreen({
  error,
  where,
  onRetry,
  onLeave,
}: {
  error: Error;
  where: string;
  onRetry: () => void;
  /** Back to the sessions list; absent when there is nowhere else to go. */
  onLeave?: () => void;
}) {
  const {color} = useTheme();
  useEffect(() => {
    console.error(`render error in ${where}`, error);
  }, [error, where]);
  return (
    <View style={[styles.box, {backgroundColor: color.bg}]}>
      <Text variant='bodyStrong'>Something went wrong</Text>
      <View style={styles.actions}>
        <Button label='Reload' onPress={onRetry} />
        {onLeave ? (
          <Button label='Sessions' kind='outline' onPress={onLeave} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    padding: space.xl,
  },
  actions: {flexDirection: 'row', gap: space.md},
});
