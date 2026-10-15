import {StyleSheet, View} from 'react-native';

import {type UpdateReady} from '@/src/data/uploaders';
import {space} from '@/src/design';
import {Button, Text} from '@/src/ui';

/** The banner's row, in the Windows app card: the same words, the same button. */
export function UpdateRow({
  ready,
  restart,
}: {
  ready: UpdateReady | null;
  restart: (() => unknown) | null;
}) {
  if (!ready) return null;
  return (
    <View style={styles.row}>
      <Text variant='data' tone='textSecondary' style={styles.text}>
        {ready.line}
      </Text>
      {ready.canRestart && restart && (
        <Button label='Restart' kind='outline' onPress={() => void restart()} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  text: {flex: 1},
});
