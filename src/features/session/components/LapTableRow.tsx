import {Pressable, StyleSheet, View} from 'react-native';

import {fonts, size, space, useTheme} from '@/src/design';
import {Button, Checkbox, Text} from '@/src/ui';

import {
  type LapRowModel,
  type NoteRowModel,
  type SectionTable,
  type StintRowModel,
} from '../model';

// Columns from the handoff: checkbox | Lap | Time | vs med | S1 | S2 | S3 | Tags.
export const LAP_COLS = {chk: 16, lap: 30, time: 62, gap: 44, sector: 38};
// Desktop D1 (≥1280): 18 | 40 | 30 | 78 | 62 | 60 | 60 | 60 | 1fr, 26 pt rows,
// adding Stint (34, not 30, so the "STINT" header fits). The handoff's Top km/h
// column is left out: laps carry no max speed.
const WIDE_COLS = {chk: 18, lap: 40, stint: 34, time: 78, gap: 62, sector: 60};
export const ROW_H = size.lapRow;
export const WIDE_ROW_H = 26;
const colsFor = (wide: boolean) => (wide ? WIDE_COLS : LAP_COLS);

// Desktop: a column per section. The columns before them are fixed, five gaps
// separate the fixed cells and the tags, and the tags keep at least TAGS_MIN, so
// the sections share what is left, between SECTION_MIN and the old 60.
const WIDE_GAP = space.md;
const TAGS_MIN = 70;
const SECTION_MIN = 40;
const FIXED_W =
  WIDE_COLS.chk +
  WIDE_COLS.lap +
  WIDE_COLS.stint +
  WIDE_COLS.time +
  WIDE_COLS.gap;
export function sectionColW(width: number, count: number): number {
  if (count === 0) return WIDE_COLS.sector;
  const room = width - FIXED_W - WIDE_GAP * (5 + count) - TAGS_MIN;
  return Math.max(
    SECTION_MIN,
    Math.min(WIDE_COLS.sector, Math.floor(room / count)),
  );
}

export function LapTableHeader({
  width,
  wide = false,
  heads = ['S1', 'S2', 'S3'],
  headTaps,
  onHeadPress,
}: {
  width: number;
  wide?: boolean;
  /** The section columns' labels; the phone keeps the game's sectors. */
  heads?: string[];
  /** Which heads are taps (the start straight is not). */
  headTaps?: boolean[];
  /** Tap a section column: the index of its head. Absent, the heads are labels only. */
  onHeadPress?: (index: number) => void;
}) {
  const {color} = useTheme();
  const cols = colsFor(wide);
  const sectionW = wide ? sectionColW(width, heads.length) : cols.sector;
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
        wide && styles.wide,
        {width, backgroundColor: color.surface, borderColor: color.lineHeader},
      ]}>
      <View style={{width: cols.chk}} />
      {cell('Lap', cols.lap, false)}
      {wide && cell('Stint', WIDE_COLS.stint, false)}
      {cell('Time', cols.time)}
      {cell('vs med', cols.gap)}
      {heads.map((h, i) => {
        const text = (
          <Text
            key={h}
            variant='tableHeader'
            tone='textMuted'
            numberOfLines={1}
            style={[styles.right, {width: sectionW}]}>
            {h}
          </Text>
        );
        return onHeadPress && headTaps?.[i] ? (
          <Pressable
            key={`${h}-${i}`}
            accessibilityRole='button'
            accessibilityLabel={`Open ${h} in Compare`}
            onPress={() => onHeadPress(i)}>
            {text}
          </Pressable>
        ) : (
          text
        );
      })}
      <Text
        variant='tableHeader'
        tone='textMuted'
        style={[styles.flex, wide && styles.tagsWide]}>
        Tags
      </Text>
    </View>
  );
}

/**
 * A line of numbers under a stint header or a pit lap (fuel and Virtual
 * Energy). Muted and one line, at the height of a lap row so the list's fixed
 * row layout still holds.
 */
export function NoteRow({
  row,
  width,
  wide = false,
  onPress,
}: {
  row: NoteRowModel;
  width: number;
  wide?: boolean;
  /** Given on a pit line when the stop's column is on screen to go to. */
  onPress?: () => void;
}) {
  const {color} = useTheme();
  const body = (
    <>
      <Text
        variant='dataSmall'
        tone='textSecondary'
        numberOfLines={1}
        style={styles.noteText}>
        {row.text}
      </Text>
      {onPress ? (
        <Text variant='dataSmall' tone='accentInk'>
          Stop ›
        </Text>
      ) : null}
    </>
  );
  const style = [
    styles.note,
    wide && styles.wide,
    {width, borderColor: color.line},
  ];
  return onPress ? (
    <Pressable
      accessibilityRole='link'
      accessibilityLabel={`${row.text}. Show this stop in the Pit stops card`}
      onPress={onPress}
      style={style}>
      {body}
    </Pressable>
  ) : (
    <View style={style}>{body}</View>
  );
}

export function StintRow({
  row,
  width,
  wide = false,
  onSelectStint,
}: {
  row: StintRowModel;
  width: number;
  wide?: boolean;
  onSelectStint: () => void;
}) {
  const {color} = useTheme();
  return (
    <View
      style={[
        styles.stint,
        wide && styles.wide,
        {width, borderColor: color.line},
      ]}>
      {/* The button sits beside the label, not at the far end of the row (triage #10). */}
      <Text
        variant='dataSmall'
        style={[styles.stintText, styles.stintLabel]}
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
  wide = false,
  onSectionPress,
  sectionTaps,
  lapColor,
  onPress,
  onToggle,
}: {
  row: LapRowModel;
  width: number;
  wide?: boolean;
  lapColor: string | undefined;
  onPress: () => void;
  onToggle: () => void;
  /** Which section columns are taps (the start straight is not). */
  sectionTaps?: boolean[];
  /** Tap a lap x section cell: the index of its section column. */
  onSectionPress?: (index: number) => void;
}) {
  const {color} = useTheme();
  const cols = colsFor(wide);
  // The lap x section grid where the map has sections (desktop and phone); the game's sectors otherwise.
  const useSections = row.sections.length > 0;
  const cells = useSections ? row.sections : row.sectors;
  const cellW = wide ? sectionColW(width, cells.length) : cols.sector;
  // Desktop has room for every tag; the phone shows the first plus a count.
  const shownTags = wide ? row.tags : row.tags.slice(0, 1);
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`${row.label} ${row.time}`}
      style={[
        styles.row,
        wide && styles.wide,
        {width, borderColor: color.line, opacity: row.comparable ? 1 : 0.5},
        row.highlighted && {backgroundColor: color.accentTint},
      ]}>
      {row.highlighted && (
        <View style={[styles.hlBar, {backgroundColor: color.accent}]} />
      )}
      <View style={{width: cols.chk}}>
        <Checkbox
          checked={row.selIndex != null}
          fill={lapColor}
          onToggle={onToggle}
          label={`Compare ${row.label}`}
        />
      </View>
      <Text variant='dataStrong' style={{width: cols.lap}}>
        {row.label}
      </Text>
      {wide && (
        <Text variant='data' tone='textFaint' style={{width: WIDE_COLS.stint}}>
          {row.stint}
        </Text>
      )}
      <Text variant='data' style={[styles.right, {width: cols.time}]}>
        {row.time}
      </Text>
      <Text
        variant='data'
        tone={row.gapFaster ? 'faster' : 'textSecondary'}
        style={[styles.right, {width: cols.gap}]}>
        {row.gap ?? ''}
      </Text>
      {cells.map((s, i) => {
        const text = (
          <Text
            key={i}
            variant='data'
            tone={s.best ? 'best' : 'textSecondary'}
            style={[styles.right, {width: cellW}]}>
            {s.value}
          </Text>
        );
        return useSections && onSectionPress && sectionTaps?.[i] ? (
          <Pressable
            key={i}
            accessibilityRole='button'
            accessibilityLabel={`${row.label} section ${i + 1} in Corner`}
            onPress={() => onSectionPress(i)}>
            {text}
          </Pressable>
        ) : (
          text
        );
      })}
      <Text
        variant='dataSmall'
        numberOfLines={1}
        style={[styles.flex, wide && styles.tagsWide]}>
        {shownTags.map((t, i) => (
          <Text
            key={t.code}
            variant='dataSmall'
            tone={t.best ? 'best' : 'textMuted'}
            style={styles.tag}>
            {i > 0 ? ' ' : ''}
            {t.code}
          </Text>
        ))}
        {row.tags.length > shownTags.length && (
          <Text variant='dataSmall' tone='textFaint' style={styles.tag}>
            {` +${row.tags.length - shownTags.length}`}
          </Text>
        )}
      </Text>
    </Pressable>
  );
}

/** Median, best and spread of each section column, under the desktop table. */
export function SectionFooter({
  table,
  width,
}: {
  table: SectionTable;
  width: number;
}) {
  const {color} = useTheme();
  const sectionW = sectionColW(width, table.heads.length);
  return (
    <View style={[styles.footerRows, {width, borderColor: color.lineHeader}]}>
      {table.footer.map(r => (
        <View key={r.label} style={[styles.wide, styles.footerRow]}>
          <Text
            variant='tableHeader'
            tone='textMuted'
            style={{width: FIXED_W + WIDE_GAP * 4}}>
            {r.label}
          </Text>
          {r.cells.map((c, i) => (
            <Text
              key={i}
              variant='data'
              tone={r.label === 'Best' ? 'best' : 'textSecondary'}
              style={[styles.right, {width: sectionW}]}>
              {c}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  footerRows: {borderTopWidth: 1, alignSelf: 'center'},
  footerRow: {flexDirection: 'row', alignItems: 'center'},
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
  stintText: {flexShrink: 1},
  // 10 pt like the tags: the longest line, a pit line with laps left and the
  // time in the pits, is 363 pt at 11 pt and the phone row is 343.
  noteText: {fontSize: 10, flex: 1},
  note: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
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
  hlBar: {position: 'absolute', left: -space.xl, top: 0, bottom: 0, width: 3},
  tag: {fontSize: 10},
  // Air between the last section column and the tags (triage #8).
  tagsWide: {marginLeft: space.lg},
  wide: {height: WIDE_ROW_H, gap: space.md},
});
