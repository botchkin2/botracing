import {StyleSheet, View} from 'react-native';

import {formatGap, size, space, useTheme} from '@/src/design';
import {Pressable, Text} from '@/src/ui';

import {type GridRow, type GridSort} from '../grid';
import {type SpreadBlock} from '../spreadRows';
import type {DaySet} from '@/src/data/sessions';
import {useSessionGrid} from '../useSessionGrid';
import {
  LinkedHScroll,
  type LinkedScroll,
  useLinkedScroll,
} from './linkedScroll';

// The session as a spread grid (Theme D): one row per lap, one column per
// section. The lap column stays put while the sections scroll sideways, the head
// and every row together (one linked scroll offset). The Varies row under the
// heads is the Varies most block's number for the section (spreadRows.ts), the
// pooled days named above it; the cells are this session's own gaps to its median.
const LAP_W = 92;
const CELL_W = 84;
const ROW_H = 44;
const BAR_MAX = 56;

/** `ticked` and `onTap` come from the screen's one resolved selection. */
export function SessionGrid({
  id,
  ticked,
  spread,
  onTap,
  day = null,
}: {
  id: string;
  ticked: readonly string[];
  /** The model's spread block: what each section varies by, and which laps that is of. */
  spread: SpreadBlock;
  onTap: (lapId: string) => void;
  /** A day: the grid of its merged laps. */
  day?: DaySet | null;
}) {
  const {color} = useTheme();
  const link = useLinkedScroll();
  const state = useSessionGrid(id, ticked, day);
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
      {spread.line != null ? (
        <Text variant='dataSmall' tone='textMuted' style={styles.line}>
          {`Varies: ${spread.line}`}
        </Text>
      ) : null}
      <View style={styles.row}>
        <View style={[styles.lap, {width: LAP_W}]}>
          <Text variant='label'>Lap</Text>
          <Text variant='dataSmall' tone='textMuted'>
            Varies
          </Text>
        </View>
        <LinkedHScroll link={link}>
          <View style={styles.row}>
            {grid.columns.map((c, i) => {
              const vary = spread.columns[i];
              return (
                <Pressable
                  key={i}
                  accessibilityRole='button'
                  accessibilityLabel={`Sort by ${c.head}`}
                  onPress={() => onHead(i)}
                  style={[styles.head, {width: CELL_W}]}>
                  <Text
                    variant='label'
                    asWritten
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
                          width: Math.round((vary?.frac ?? 0) * BAR_MAX),
                          backgroundColor: color.textMuted,
                        },
                      ]}
                    />
                  </View>
                  <Text variant='dataSmall' tone='textMuted'>
                    {vary?.offsShort ?? vary?.seconds ?? '—'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </LinkedHScroll>
      </View>
      {grid.rows.map(r => (
        <GridLapRow key={r.lapId} row={r} link={link} onTap={onTap} />
      ))}
    </View>
  );
}

function isSorted(sort: GridSort, i: number): boolean {
  return sort.kind === 'column' && sort.index === i;
}

function GridLapRow({
  row,
  link,
  onTap,
}: {
  row: GridRow;
  link: LinkedScroll;
  onTap: (id: string) => void;
}) {
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
      <LinkedHScroll link={link}>
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
                {c.deltaS == null
                  ? c.off
                    ? 'off'
                    : '—'
                  : formatGap(c.deltaS, 3)}
              </Text>
            </View>
          ))}
        </View>
      </LinkedHScroll>
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
  line: {paddingHorizontal: space.sm},
  row: {flexDirection: 'row', alignItems: 'stretch'},
  lapRow: {minHeight: ROW_H, alignItems: 'center'},
  lap: {paddingHorizontal: space.sm, justifyContent: 'center'},
  // A full 44 pt box: the heads sit in a scroller, which clips any hit slop.
  head: {
    minHeight: size.hit,
    paddingHorizontal: space.sm,
    gap: 2,
    justifyContent: 'center',
  },
  barTrack: {height: 4, borderRadius: 2, overflow: 'hidden'},
  bar: {height: 4},
  cell: {
    minHeight: ROW_H,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  dim: {opacity: 0.45},
});
