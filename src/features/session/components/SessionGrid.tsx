import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {formatGap, space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import {type GridRow, type GridSort} from '../grid';
import {useSessionGrid} from '../useSessionGrid';

// The session as a spread grid (Theme D): one row per lap, one column per
// section. The lap column stays put while the sections scroll sideways.
const LAP_W = 92;
const CELL_W = 84;
const ROW_H = 44;
const BAR_MAX = 56;

/** `ticked` and `onTap` come from the screen's one resolved selection. */
export function SessionGrid({
  id,
  ticked,
  onTap,
}: {
  id: string;
  ticked: readonly string[];
  onTap: (lapId: string) => void;
}) {
  const {color} = useTheme();
  const state = useSessionGrid(id, ticked);
  if (!state) return null;
  const {grid, sort, setSort} = state;

  const onHead = (index: number) =>
    setSort(
      sort.kind === 'column' && sort.index === index && sort.dir === 'asc'
        ? {kind: 'column', index, dir: 'desc'}
        : {kind: 'column', index, dir: 'asc'},
    );

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={[styles.lap, {width: LAP_W}]}>
          <Text variant='label'>Lap</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.row}>
            {grid.columns.map((c, i) => (
              <Pressable
                key={i}
                accessibilityRole='button'
                accessibilityLabel={`Sort by ${c.head}`}
                onPress={() => onHead(i)}
                style={[styles.head, {width: CELL_W}]}>
                <Text
                  variant='label'
                  tone={isSorted(sort, i) ? 'accentInk' : 'textSecondary'}>
                  {c.head}
                </Text>
                <View
                  style={[
                    styles.barTrack,
                    {backgroundColor: color.lineHeader},
                  ]}>
                  <View
                    style={[
                      styles.bar,
                      {
                        width: Math.round(c.barFraction * BAR_MAX),
                        backgroundColor: color.textMuted,
                      },
                    ]}
                  />
                </View>
                <Text variant='dataSmall' tone='textMuted'>
                  {c.spreadS == null ? '—' : `${c.spreadS.toFixed(2)} s`}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>
      {grid.rows.map(r => (
        <GridLapRow key={r.lapId} row={r} onTap={onTap} />
      ))}
    </View>
  );
}

function isSorted(sort: GridSort, i: number): boolean {
  return sort.kind === 'column' && sort.index === i;
}

function GridLapRow({row, onTap}: {row: GridRow; onTap: (id: string) => void}) {
  const {color} = useTheme();
  return (
    <Pressable
      accessibilityRole='checkbox'
      accessibilityState={{checked: row.ticked}}
      accessibilityLabel={`${row.label}${row.ticked ? ', ticked' : ''}`}
      onPress={() => onTap(row.lapId)}
      style={[styles.row, styles.lapRow, !row.ticked && styles.dim]}>
      <View style={[styles.lap, {width: LAP_W}]}>
        <Text variant='dataSmall' tone='text'>
          {row.label}
        </Text>
        {row.stop ? (
          <Text variant='dataSmall' tone='textMuted'>
            stop
          </Text>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.row}>
          {row.cells.map((c, i) => (
            <View
              key={i}
              style={[
                styles.cell,
                {
                  width: CELL_W,
                  backgroundColor: tint(c.unit, color.faster, color.slower),
                },
              ]}>
              <Text variant='dataSmall' tone={c.best ? 'best' : 'text'}>
                {c.deltaS == null ? '—' : formatGap(c.deltaS, 3)}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </Pressable>
  );
}

/** Faster is green, slower red, by how far out the cell is; 0 is no tint. */
function tint(
  unit: number,
  faster: string,
  slower: string,
): string | undefined {
  if (unit === 0) return undefined;
  return unit > 0
    ? withAlpha(slower, Math.abs(unit) * 0.35)
    : withAlpha(faster, Math.abs(unit) * 0.35);
}

function withAlpha(hex: string, a: number): string {
  const n = Math.round(Math.min(1, Math.max(0, a)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${n}`;
}

const styles = StyleSheet.create({
  wrap: {gap: space.xs, paddingVertical: space.sm},
  row: {flexDirection: 'row', alignItems: 'stretch'},
  lapRow: {minHeight: ROW_H, alignItems: 'center'},
  lap: {paddingHorizontal: space.sm, justifyContent: 'center'},
  head: {paddingHorizontal: space.sm, gap: 2, justifyContent: 'center'},
  barTrack: {height: 4, borderRadius: 2, overflow: 'hidden'},
  bar: {height: 4},
  cell: {
    minHeight: ROW_H,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  dim: {opacity: 0.45},
});
