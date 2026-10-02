import {Pressable, StyleSheet} from 'react-native';

import {hitBox} from '@/src/design';
import {Text} from '@/src/ui';

import {type EnergyLine} from '../energyLine';

/**
 * The session's energy start and end as one line under the facts. It opens the
 * card that holds the detail, when there is one (pit-wall thread 44 #1918).
 */
export function EnergyLineRow({
  line,
  onPress,
}: {
  line: EnergyLine;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={line.target ? 'link' : 'text'}
      accessibilityLabel={`Energy: ${line.text}`}
      disabled={line.target == null}
      onPress={onPress}
      style={styles.row}>
      <Text variant='label' tone='textMuted'>
        Energy
      </Text>
      <Text variant='dataStrong'>{line.text}</Text>
    </Pressable>
  );
}

// The 44 pt control height (CODE_STANDARDS §5).
const styles = StyleSheet.create({
  row: {...hitBox.link},
});
