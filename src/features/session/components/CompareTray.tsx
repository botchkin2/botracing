import {StyleSheet, View} from 'react-native';

import {radius, size, space, useTheme} from '@/src/design';
import {Button, Chip, Text} from '@/src/ui';

import {type TrayModel} from '../model';

/**
 * Floating tray: with two or more stints, a Stint row of chips that each
 * select that stint's comparable laps (D16/D17: stint, Compare, untick, three
 * taps); then a color square per selected lap, label, Clear, Compare n →.
 */
export function CompareTray({
  tray,
  colorOf,
  onClear,
  onCompare,
  onStint,
}: {
  tray: TrayModel;
  colorOf: (selIndex: number) => string;
  onClear: () => void;
  onCompare: () => void;
  onStint: (lapIds: string[]) => void;
}) {
  const {color} = useTheme();
  return (
    <View
      style={[
        styles.tray,
        {backgroundColor: color.surfaceOverlay, borderColor: color.lineStrong},
      ]}>
      {tray.stints.length > 0 ? (
        <View style={styles.row}>
          <Text variant='tableHeader' tone='textMuted'>
            Stint
          </Text>
          {tray.stints.map(s => (
            <Chip
              key={s.n}
              label={s.label}
              selected={s.active}
              minWidth={size.hit}
              onPress={() => onStint(s.lapIds)}
            />
          ))}
        </View>
      ) : null}
      {tray.count > 0 ? (
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
          <Button label={`Compare ${tray.count} →`} onPress={onCompare} />
        </View>
      ) : null}
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
