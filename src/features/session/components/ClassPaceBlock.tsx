import {useState} from 'react';
import {StyleSheet, View} from 'react-native';

import {
  cornerCell,
  formatGap,
  formatLapTime,
  hitBox,
  radius,
  space,
  useLayout,
  useTheme,
} from '@/src/design';
import {Pressable, Segment, Text} from '@/src/ui';

import {type ClassPaceDoc} from '@/src/analysis/classPace';

import {classPaceView, type PaceRow, SECTOR_HEADS} from '../classPaceView';

// The Session's Class pace block (ticket 20; livery's layout, pit-wall thread
// 111 #7653): the game's own three sectors of every driver of a class beside his.
// A cell is his median minus theirs on the corner-cell colours (red where they
// gain on him); the block draws what classPaceView gives and subtracts nothing.
// No names and no numbers: "P3 · Ford Mustang".

const POS_W = 24;
const TIME_W = 62;
const CELL_W = 18;
// On a desktop the cell has room for its seconds (livery #7653).
const CELL_W_WIDE = 46;
const CELL_H = 18;
const cellW = (wide: boolean) => (wide ? CELL_W_WIDE : CELL_W);
const cellsW = (wide: boolean) => cellW(wide) * 3 + 4;
const ROW_H = 44;

const timeText = (s: number | null) => (s === null ? '—' : formatLapTime(s));

function Cell({deltaS, wide}: {deltaS: number | null; wide: boolean}) {
  const {color} = useTheme();
  const c = deltaS === null ? null : cornerCell(deltaS);
  return (
    <View
      style={[
        styles.cell,
        {width: cellW(wide), backgroundColor: c ? c.bg : color.surfaceRaised},
      ]}>
      {wide && c && deltaS !== null ? (
        <Text variant='axis' style={[styles.cellText, {color: c.fg}]}>
          {formatGap(deltaS, 2)}
        </Text>
      ) : null}
    </View>
  );
}

/** One sector of the top line: its name and his signed difference on its cell colour. */
function TopChip({head, deltaS}: {head: string; deltaS: number | null}) {
  const {color} = useTheme();
  const c = deltaS === null ? null : cornerCell(deltaS);
  return (
    <View
      style={[
        styles.topChip,
        {backgroundColor: c ? c.bg : color.surfaceRaised},
      ]}>
      <Text
        variant='dataSmall'
        style={c ? {color: c.fg} : undefined}
        tone={c ? undefined : 'textMuted'}>
        {`${head} ${deltaS === null ? '—' : formatGap(deltaS, 2)}`}
      </Text>
    </View>
  );
}

function Detail({row}: {row: PaceRow}) {
  const d = row.detail;
  if (!d) return null;
  const line = (label: string, values: (number | null)[], strong?: boolean) => (
    <View style={styles.detailRow}>
      <Text variant='dataSmall' tone='textMuted' style={styles.detailLabel}>
        {label}
      </Text>
      {values.map((v, i) => (
        <Text
          key={SECTOR_HEADS[i]}
          variant={strong ? 'dataStrong' : 'dataSmall'}
          style={styles.detailValue}>
          {v === null ? '—' : v.toFixed(2)}
        </Text>
      ))}
    </View>
  );
  return (
    <View style={styles.detail}>
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel} variant='dataSmall'>
          {' '}
        </Text>
        {SECTOR_HEADS.map(h => (
          <Text
            key={h}
            variant='label'
            tone='textMuted'
            style={styles.detailValue}>
            {h}
          </Text>
        ))}
      </View>
      {line('Best', d.bestS)}
      {line('Median', d.medianS)}
      {line('You', d.youS, true)}
    </View>
  );
}

function Row({
  row,
  open,
  wide,
  onPress,
}: {
  row: PaceRow;
  open: boolean;
  wide: boolean;
  onPress: () => void;
}) {
  const {color} = useTheme();
  const tappable = row.detail !== null;
  const body = (
    <View style={[styles.row, row.you && {borderLeftColor: color.accent}]}>
      <Text variant='dataSmall' tone='textMuted' style={styles.pos}>
        {row.pos}
      </Text>
      <Text
        variant={row.you ? 'dataStrong' : 'dataSmall'}
        tone={row.you ? 'accentInk' : undefined}
        numberOfLines={1}
        style={styles.car}>
        {row.you ? 'You' : row.car}
      </Text>
      <Text variant='dataSmall' style={styles.time}>
        {timeText(row.bestS)}
      </Text>
      <Text variant='dataSmall' style={styles.time}>
        {timeText(row.medianS)}
      </Text>
      {row.cellsS ? (
        <View style={[styles.cells, {width: cellsW(wide)}]}>
          {row.cellsS.map((c, i) => (
            <Cell key={SECTOR_HEADS[i]} deltaS={c} wide={wide} />
          ))}
        </View>
      ) : (
        <View style={[styles.cells, {width: cellsW(wide)}]} />
      )}
    </View>
  );
  return (
    <View>
      {tappable ? (
        <Pressable
          accessibilityRole='button'
          accessibilityState={{expanded: open}}
          accessibilityLabel={`${row.car} sectors against yours`}
          onPress={onPress}
          style={hitBox.link}>
          {body}
        </Pressable>
      ) : (
        body
      )}
      {open ? <Detail row={row} /> : null}
    </View>
  );
}

/**
 * The block for a session's `classPace`. The class chip, the row a tap opens and
 * "All N ›" are this component's own state; classPaceView is given them.
 */
export function ClassPaceBlock({doc}: {doc: ClassPaceDoc}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const {color} = useTheme();
  const wide = useLayout().isDesktop;
  const view = classPaceView(doc, selected, all);
  if (!view) return null;
  const pick = (cls: string) => {
    setSelected(cls);
    setAll(false);
    setOpen(null);
  };
  return (
    <View style={styles.block}>
      {/* Its basis named once, over every Best and Median of the block, his included (livery #7716): the head's own Median is the lap selection's. */}
      <Text variant='label' tone='textMuted'>
        Class pace · all timed laps
      </Text>
      {view.topLine ? (
        <View style={styles.top}>
          <Text variant='dataSmall' tone='textMuted'>
            {view.topLine.label}
          </Text>
          <View style={styles.topChips}>
            {SECTOR_HEADS.map((h, i) => (
              <TopChip key={h} head={h} deltaS={view.topLine!.sectorsS[i]} />
            ))}
          </View>
        </View>
      ) : null}
      {view.chips.length > 0 ? (
        <Segment
          options={view.chips.map(c => ({value: c.cls, label: c.label}))}
          value={view.selected}
          onChange={pick}
        />
      ) : null}
      <View style={[styles.head, {borderColor: color.lineHeader}]}>
        <Text variant='label' tone='textMuted' style={styles.pos}>
          Pos
        </Text>
        <Text variant='label' tone='textMuted' style={styles.car}>
          Car
        </Text>
        <Text variant='label' tone='textMuted' style={styles.time}>
          Best
        </Text>
        <Text variant='label' tone='textMuted' style={styles.time}>
          Median
        </Text>
        <View style={[styles.cells, {width: cellsW(wide)}]}>
          {view.cells
            ? SECTOR_HEADS.map(h => (
                <Text
                  key={h}
                  variant='axis'
                  tone='textFaint'
                  style={[styles.cellHead, {width: cellW(wide)}]}>
                  {h}
                </Text>
              ))
            : null}
        </View>
      </View>
      {view.rows.map(row => (
        <Row
          key={row.key}
          row={row}
          open={open === row.key}
          wide={wide}
          onPress={() => setOpen(open === row.key ? null : row.key)}
        />
      ))}
      {view.hidden > 0 ? (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`Show all ${view.total} cars`}
          onPress={() => setAll(true)}
          style={[hitBox.link, styles.more]}>
          <Text
            variant='dataSmall'
            tone='accentInk'>{`All ${view.total} ›`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {gap: space.xs},
  top: {gap: space.xs},
  topChips: {flexDirection: 'row', gap: space.xs},
  topChip: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderBottomWidth: 1,
    paddingBottom: space.xs,
  },
  row: {
    minHeight: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
  },
  pos: {width: POS_W, textAlign: 'right'},
  car: {flex: 1},
  time: {width: TIME_W, textAlign: 'right'},
  cells: {flexDirection: 'row', gap: 2},
  cell: {
    height: CELL_H,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellText: {textAlign: 'center'},
  cellHead: {textAlign: 'center'},
  detail: {paddingBottom: space.sm, paddingLeft: POS_W + space.xs},
  detailRow: {flexDirection: 'row', gap: space.xs},
  detailLabel: {width: 52},
  detailValue: {width: 54, textAlign: 'right'},
  more: {alignSelf: 'flex-start', justifyContent: 'center'},
});
