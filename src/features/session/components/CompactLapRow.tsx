import {StyleSheet, View} from 'react-native';

import {CornerCells} from '@/src/charts/CornerGrid';
import {monoCharWidth, space, type, useTheme} from '@/src/design';
import {Checkbox, Pressable, Text} from '@/src/ui';

import {compactHeads} from '../compactHeads';
import type {LapRowModel} from '../model';
import {ROW_H} from './LapTableRow';

// The phone's lap table: Lap, Time, vs med, then one color cell per section, all
// on screen with no sideways scroll. A cell is the lap's gap to the section's
// median over the basis laps on the Corner color scale (design/tokens.ts
// cornerCell), so the section a lap lost its time in shows at a glance; the
// number needs room, and shows where the cell has it.
const CHAR_W = monoCharWidth(type.data);
const COLS = {
  chk: 16,
  lap: 40,
  // "2:04.323" and "−0.412".
  time: Math.ceil(8 * CHAR_W),
  gap: Math.ceil(7 * CHAR_W),
};
export const COMPACT_FIXED_W =
  COLS.chk + COLS.lap + COLS.time + COLS.gap + 4 * space.xs;
/** A cell this wide has room for its number ("+.12"). */
const VALUE_MIN_W = Math.ceil(4 * monoCharWidth(type.dataSmall)) + 4;
// The game's sectors, when the layout has no section map yet: raw times.
const SECTOR_W = 38;

/** Width of one section cell in a row of `width`: the sections share what the fixed columns leave. */
export function compactCellW(width: number, count: number): number {
  if (count === 0) return SECTOR_W;
  return Math.max(4, Math.floor((width - COMPACT_FIXED_W) / count) - 2);
}

export function CompactLapHeader({
  width,
  heads,
}: {
  width: number;
  /** The section columns' labels, or the game's sector heads before the map is there. */
  heads: string[];
}) {
  const {color} = useTheme();
  const cellW = compactCellW(width, heads.length);
  const labels = compactHeads(heads, cellW);
  const head = (label: string, w: number, right = true) => (
    <Text
      variant='tableHeader'
      tone='textMuted'
      style={[{width: w}, right && styles.right]}>
      {label}
    </Text>
  );
  return (
    <View
      style={[
        styles.header,
        {width, backgroundColor: color.surface, borderColor: color.lineHeader},
      ]}>
      <View style={{width: COLS.chk}} />
      {head('Lap', COLS.lap, false)}
      {head('Time', COLS.time)}
      {head('vs med', COLS.gap)}
      <View style={styles.cells}>
        {labels.map((h, i) => (
          <Text
            key={i}
            variant='tableHeader'
            tone='textMuted'
            asWritten
            numberOfLines={1}
            style={[styles.center, {width: cellW + 2}]}>
            {h}
          </Text>
        ))}
      </View>
    </View>
  );
}

export function CompactLapRow({
  row,
  width,
  heads,
  lapColor,
  onPress,
  onToggle,
}: {
  row: LapRowModel;
  width: number;
  heads: string[];
  lapColor: string | undefined;
  onPress: () => void;
  onToggle: () => void;
}) {
  const {color} = useTheme();
  const colored = row.sectionDeltas.length > 0;
  const cellW = compactCellW(width, colored ? row.sectionDeltas.length : 0);
  // One tag fits under the lap, by its code ("TOW"; the seconds are in the lap's detail).
  const tag = row.tags[0];
  const more = row.tags.length - 1;
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`${row.label} ${row.time}`}
      style={[
        styles.row,
        !row.comparable && styles.dim,
        {width, borderColor: color.line},
        row.highlighted && {backgroundColor: color.accentTint},
      ]}>
      {row.highlighted && (
        <View style={[styles.hlBar, {backgroundColor: color.accent}]} />
      )}
      <View style={{width: COLS.chk}}>
        <Checkbox
          checked={row.selIndex != null}
          fill={lapColor}
          onToggle={onToggle}
          label={`Compare ${row.label}`}
        />
      </View>
      <View style={{width: COLS.lap}}>
        <Text variant='dataStrong'>{row.label}</Text>
        {tag ? (
          <Text
            variant='dataTag'
            tone={tag.best ? 'best' : 'textMuted'}
            numberOfLines={1}>
            {tag.code.split(' ')[0] + (more > 0 ? ` +${more}` : '')}
          </Text>
        ) : null}
      </View>
      <Text variant='data' style={[styles.right, {width: COLS.time}]}>
        {row.time}
      </Text>
      <Text
        variant='data'
        tone={row.gapFaster ? 'faster' : 'textSecondary'}
        style={[styles.right, {width: COLS.gap}]}>
        {row.gap ?? ''}
      </Text>
      <View style={styles.cells}>
        {colored ? (
          <CornerCells
            cells={row.sectionDeltas}
            cellW={cellW}
            showValue={cellW >= VALUE_MIN_W}
            labels={heads}
          />
        ) : (
          row.sectors.map((s, i) => (
            <Text
              key={i}
              variant='data'
              tone={s.best ? 'best' : 'textSecondary'}
              style={[styles.right, {width: SECTOR_W}]}>
              {s.value}
            </Text>
          ))
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: 26,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    alignSelf: 'center',
  },
  row: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderBottomWidth: 1,
    alignSelf: 'center',
  },
  dim: {opacity: 0.5},
  cells: {flexDirection: 'row', alignItems: 'center'},
  right: {textAlign: 'right'},
  center: {textAlign: 'center'},
  hlBar: {position: 'absolute', left: -space.xl, top: 0, bottom: 0, width: 3},
});
