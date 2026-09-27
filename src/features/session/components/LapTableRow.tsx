import {Pressable, StyleSheet, View} from 'react-native';

import {fonts, size, space, useTheme} from '@/src/design';
import {Button, Checkbox, Text} from '@/src/ui';

import {type LapRowModel, type StintRowModel} from '../model';

// Columns from the handoff: checkbox | Lap | Time | vs med | S1 | S2 | S3 | Tags.
export const LAP_COLS = {chk: 16, lap: 30, time: 62, gap: 44, sector: 38};
export const ROW_H = size.lapRow;

export function LapTableHeader({width}: {width: number}) {
  const {color} = useTheme();
  const cell = (label: string, w?: number, right = true) => (
    <Text
      variant='tableHeader'
      tone='textMuted'
      style={[w ? {width: w} : styles.flex, right && styles.right]}>
      {label}
    </Text>
  );
  return (
    <View
      style={[
        styles.header,
        {width, backgroundColor: color.surface, borderColor: color.lineHeader},
      ]}>
      <View style={{width: LAP_COLS.chk}} />
      {cell('Lap', LAP_COLS.lap, false)}
      {cell('Time', LAP_COLS.time)}
      {cell('vs med', LAP_COLS.gap)}
      {cell('S1', LAP_COLS.sector)}
      {cell('S2', LAP_COLS.sector)}
      {cell('S3', LAP_COLS.sector)}
      {cell('Tags', undefined, false)}
    </View>
  );
}

export function StintRow({
  row,
  width,
  onSelectStint,
}: {
  row: StintRowModel;
  width: number;
  onSelectStint: () => void;
}) {
  const {color} = useTheme();
  return (
    <View style={[styles.stint, {width, borderColor: color.line}]}>
      <Text
        variant='dataSmall'
        style={[styles.flex, styles.stintLabel]}
        numberOfLines={1}>
        {row.label}
      </Text>
      {row.lapIds.length > 0 && (
        <Button kind='tertiary' label='Select stint' onPress={onSelectStint} />
      )}
    </View>
  );
}

export function LapRow({
  row,
  width,
  lapColor,
  onPress,
  onToggle,
}: {
  row: LapRowModel;
  width: number;
  lapColor: string | undefined;
  onPress: () => void;
  onToggle: () => void;
}) {
  const {color} = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`${row.label} ${row.time}`}
      style={[
        styles.row,
        {width, borderColor: color.line, opacity: row.comparable ? 1 : 0.5},
        row.highlighted && {backgroundColor: color.accentTint},
      ]}>
      {row.highlighted && (
        <View style={[styles.hlBar, {backgroundColor: color.accent}]} />
      )}
      <View style={{width: LAP_COLS.chk}}>
        <Checkbox
          checked={row.selIndex != null}
          fill={lapColor}
          onToggle={onToggle}
          label={`Compare ${row.label}`}
        />
      </View>
      <Text variant='dataStrong' style={{width: LAP_COLS.lap}}>
        {row.label}
      </Text>
      <Text variant='data' style={[styles.right, {width: LAP_COLS.time}]}>
        {row.time}
      </Text>
      <Text
        variant='data'
        tone={row.gapFaster ? 'faster' : 'textSecondary'}
        style={[styles.right, {width: LAP_COLS.gap}]}>
        {row.gap ?? ''}
      </Text>
      {row.sectors.map((s, i) => (
        <Text
          key={i}
          variant='data'
          tone={s.best ? 'best' : 'textSecondary'}
          style={[styles.right, {width: LAP_COLS.sector}]}>
          {s.value}
        </Text>
      ))}
      <Text variant='dataSmall' numberOfLines={1} style={styles.flex}>
        {row.tags.map((t, i) => (
          <Text
            key={t.code}
            variant='dataSmall'
            tone={t.best ? 'best' : 'textMuted'}
            style={styles.tag}>
            {i > 0 ? ' ' : ''}
            {t.code}
          </Text>
        ))}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  right: {textAlign: 'right'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: 26,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    alignSelf: 'center',
  },
  stint: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    alignSelf: 'center',
  },
  stintLabel: {fontFamily: fonts.monoBold, fontSize: 10},
  row: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderBottomWidth: 1,
    alignSelf: 'center',
  },
  hlBar: {position: 'absolute', left: -space.xl, top: 0, bottom: 0, width: 3},
  tag: {fontSize: 10},
});
