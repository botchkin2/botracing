import {StyleSheet, View} from 'react-native';

import {radius, size, space, useTheme} from '@/src/design';
import {Pressable, Segment, Text} from '@/src/ui';

import {type TowerMode, type TowerRow} from '@/src/features/race/chase/towerRows';

const MODES = [
  {value: 'order', label: 'Order'},
  {value: 'near', label: 'Near'},
] as const;

// The timing tower on the 3D view: the cars around the followed car, a row is a tap to follow that car.
export function ChaseTower({
  rows,
  mode,
  onMode,
  onPick,
  tight,
  fill = false,
}: {
  rows: TowerRow[];
  mode: TowerMode;
  onMode: (mode: TowerMode) => void;
  onPick: (index: number) => void;
  tight: boolean;
  /** Take the width of the place it is put in, instead of the desktop tower's fixed width. */
  fill?: boolean;
}) {
  const {color} = useTheme();
  const rowH = tight ? size.hit : size.gridCell;
  return (
    <View style={[styles.box, fill && styles.boxFill, {backgroundColor: color.surface, borderColor: color.lineStrong}]}>
      <Segment options={MODES} value={mode} onChange={onMode} />
      {rows.map(r => (
        <Pressable
          key={r.index}
          accessibilityLabel={`Follow ${r.model}, ${r.classTag} place ${r.classPlace}`}
          onPress={() => onPick(r.index)}
          style={[styles.row, {height: rowH}, r.followed && {backgroundColor: color.accentTint}]}>
          <View style={[styles.bar, {backgroundColor: r.color}]} />
          <Text variant='dataSmall' tone='textMuted'>{r.classTag}</Text>
          <Text variant='dataSmall' style={styles.place}>{String(r.classPlace)}</Text>
          <Text variant={r.followed ? 'dataStrong' : 'dataSmall'} numberOfLines={1} style={styles.model}>
            {r.model}
          </Text>
          <Text variant='dataSmall' tone='textMuted' style={styles.gap}>{r.gap}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {borderWidth: 1, borderRadius: radius.sm, padding: space.xs, gap: 2, width: size.chaseTower},
  boxFill: {width: 'auto'},
  row: {flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingRight: space.xs, borderRadius: radius.sm},
  bar: {width: 3, alignSelf: 'stretch'},
  place: {width: 22, textAlign: 'right'},
  model: {flex: 1},
  gap: {minWidth: 52, textAlign: 'right'},
});
