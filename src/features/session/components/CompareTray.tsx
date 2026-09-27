import {StyleSheet, View} from 'react-native';

import {radius, space, useTheme} from '@/src/design';
import {Button, Text} from '@/src/ui';

import {type TrayModel} from '../model';

/** Floating tray: a color square per selected lap, label, Clear, Compare n →. */
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
      <Button label={`Compare ${tray.count} →`} onPress={onCompare} />
    </View>
  );
}

const styles = StyleSheet.create({
  tray: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: {width: 0, height: 8},
    elevation: 8,
  },
  swatches: {flexDirection: 'row', gap: 3},
  swatch: {width: 10, height: 10, borderRadius: radius.xs},
  label: {flex: 1},
});
