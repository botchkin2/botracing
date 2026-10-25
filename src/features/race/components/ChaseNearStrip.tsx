import {StyleSheet, View} from 'react-native';

import {radius, size, space, useTheme} from '@/src/design';
import {Pressable, Text} from '@/src/ui';

import {type TowerRow} from '@/src/features/race/chase/towerRows';

// The phone's timing tower, closed: one strip across the top of the 3D view, above the canvas, so it never covers a car.
// The followed car and its neighbours are three taps to follow; the arrow opens the full list (ChaseTower).
export function ChaseNearStrip({
  rows,
  open,
  onToggle,
  onPick,
}: {
  rows: TowerRow[];
  open: boolean;
  onToggle: () => void;
  onPick: (index: number) => void;
}) {
  const {color} = useTheme();
  return (
    <View style={[styles.strip, {backgroundColor: color.surface, borderColor: color.lineStrong}]}>
      {rows.map(r => (
        <Pressable
          key={r.index}
          accessibilityLabel={`Follow ${r.model}, ${r.classTag} place ${r.classPlace}`}
          onPress={() => onPick(r.index)}
          style={[styles.chip, r.followed && {backgroundColor: color.accentTint}]}>
          <View style={styles.top}>
            <View style={[styles.bar, {backgroundColor: r.color}]} />
            <Text variant={r.followed ? 'dataStrong' : 'dataSmall'}>{`${r.classTag} P${r.classPlace}`}</Text>
            <Text variant='dataSmall' tone='textMuted' numberOfLines={1}>{r.gap}</Text>
          </View>
          <Text variant='dataSmall' tone='textMuted' numberOfLines={1}>{r.model}</Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityLabel={open ? 'Close the car list' : 'Open the car list'}
        accessibilityState={{expanded: open}}
        onPress={onToggle}
        style={styles.more}>
        <Text variant='dataStrong'>{open ? '▴' : '▾'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: size.hit,
    borderWidth: 1,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  chip: {flex: 1, justifyContent: 'center', paddingHorizontal: space.xs},
  top: {flexDirection: 'row', alignItems: 'center', gap: space.xs},
  bar: {width: 3, height: 12},
  more: {width: size.hit, alignItems: 'center', justifyContent: 'center'},
});
