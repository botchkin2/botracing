import {StyleSheet, View} from 'react-native';

import {useTheme} from '@/src/design';

/**
 * A 2 pt accent line across the top of the window while the app works on
 * something the person is looking at (analysis on open). No text, no motion:
 * the numbers below stay readable and are replaced when the work lands.
 */
export function WorkingLine({active}: {active: boolean}) {
  const {color} = useTheme();
  if (!active) return null;
  return (
    <View
      accessibilityLabel='Updating'
      pointerEvents='none'
      style={[styles.line, {backgroundColor: color.accent}]}
    />
  );
}

const styles = StyleSheet.create({
  line: {position: 'absolute', top: 0, left: 0, right: 0, height: 2},
});
