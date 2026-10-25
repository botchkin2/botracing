import {StyleSheet, View} from 'react-native';

import {radius, space, useTheme} from '@/src/design';
import {Button, Text} from '@/src/ui';

import {type TrayModel} from '../model';

/**
 * Floating tray, one line: a color square per selected lap, "9 laps", Clear,
 * Compare →. A stint is picked from its own line in the lap table (D16/D17).
 */
export function CompareTray({
  tray,
  colorOf,
  onClear,
  onCompare,
}: {
  tray: TrayModel;
  colorOf: (selIndex: number) => string;
  onClear: () => void;
  onCompare: () => void;
}) {
  const {color} = useTheme();
  return (
    <View
      style={[
        styles.tray,
        {backgroundColor: color.surfaceOverlay, borderColor: color.lineStrong},
      ]}>
      <View style={styles.row}>
        <View style={styles.swatches}>
          {tray.laps.slice(0, 6).map(l => (
            <View
              key={l.lapId}
              style={[styles.swatch, {backgroundColor: colorOf(l.selIndex)}]}
            />
          ))}
        </View>
        <Text variant='dataStrong' numberOfLines={1} style={styles.label}>
          {tray.label}
        </Text>
        <Button kind='tertiary' label='Clear' onPress={onClear} />
        <Button label='Compare →' onPress={onCompare} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tray: {
    gap: space.sm,
    padding: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: {width: 0, height: 8},
    elevation: 8,
  },
  row: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  swatches: {flexDirection: 'row', gap: 3},
  swatch: {width: 10, height: 10, borderRadius: radius.xs},
  label: {flex: 1},
});
