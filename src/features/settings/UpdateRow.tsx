import {StyleSheet, View} from 'react-native';

import {type UpdateReady} from '@/src/data/uploaders';
import {space} from '@/src/design';
import {Button} from '@/src/ui';

/**
 * The banner's Restart button, in the Windows app card, where the tray can
 * press it. The words are the PC line's own ("v0.1.16 · v0.1.18 ready"), so the
 * row adds no second sentence about the same update.
 */
export function UpdateRow({
  ready,
  restart,
}: {
  ready: UpdateReady | null;
  restart: (() => unknown) | null;
}) {
  if (!ready?.canRestart || !restart) return null;
  return (
    <View style={styles.row}>
      <Button label='Restart' kind='outline' onPress={() => void restart()} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', gap: space.md},
});
