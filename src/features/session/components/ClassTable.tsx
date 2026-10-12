import {useState} from 'react';
import {StyleSheet, View} from 'react-native';

import {formatGap, formatLapTime, hitBox, space, useTheme} from '@/src/design';
import {Pressable, Text} from '@/src/ui';

import {type ClassEntry, type ClassRow, type ClassTable} from '../classTable';

// The Session head's class table: one row per class (Best, 5th, Cars, and the
// player's own best and place in their class's row), a tap unfolds a class to
// every car by best lap. No `best` colour: that colour is the driver's own
// best lap or sector, and a class best is not theirs. See classTable.ts.

const COLS = {name: 3, a: 2.4, b: 2.4, c: 1} as const;
// An unfolded car row: the name takes the room the gap does not need, so a
// model like 'Porsche 911 GT3 R' fits at 375.
const ENTRY_COLS = {name: 4.6, best: 2.4, gap: 1.8} as const;

export function ClassTableView({table}: {table: ClassTable}) {
  const [open, setOpen] = useState<string | null>(null);
  const {color} = useTheme();
  return (
    <View style={styles.table}>
      <View style={styles.row}>
        <Text variant='label' tone='textMuted' style={{flex: COLS.name}}>
          Class
        </Text>
        <Text
          variant='label'
          tone='textMuted'
          style={[styles.num, {flex: COLS.a}]}>
          Best
        </Text>
        <Text
          variant='label'
          tone='textMuted'
          style={[styles.num, {flex: COLS.b}]}>
          5th
        </Text>
        <Text
          variant='label'
          tone='textMuted'
          style={[styles.num, {flex: COLS.c}]}>
          Cars
        </Text>
      </View>
      {table.rows.map(row => (
        <View
          key={row.key}
          style={[styles.group, {borderColor: color.lineHeader}]}>
          <Pressable
            accessibilityRole='button'
            accessibilityState={{expanded: open === row.key}}
            accessibilityLabel={`${row.label} cars by best lap`}
            style={[styles.row, hitBox.link]}
            onPress={() => setOpen(open === row.key ? null : row.key)}>
            <Text variant='bodyStrong' style={{flex: COLS.name}}>
              {row.label}
            </Text>
            <Text variant='data' style={[styles.num, {flex: COLS.a}]}>
              {formatLapTime(row.bestS)}
            </Text>
            <Text variant='data' style={[styles.num, {flex: COLS.b}]}>
              {formatLapTime(row.fifthS)}
            </Text>
            <Text variant='data' style={[styles.num, {flex: COLS.c}]}>
              {row.cars}
            </Text>
          </Pressable>
          {row.mine ? (
            <View style={styles.row}>
              <Text
                variant='dataSmall'
                tone='textMuted'
                style={{flex: COLS.name}}>
                You
              </Text>
              <Text variant='dataSmall' style={[styles.num, {flex: COLS.a}]}>
                {formatLapTime(row.mine.bestS)}
              </Text>
              <Text
                variant='dataSmall'
                tone='textMuted'
                style={[styles.num, {flex: COLS.b + COLS.c}]}>
                {`P${row.mine.rank} / ${row.cars}`}
              </Text>
            </View>
          ) : null}
          {open === row.key ? <Entries row={row} /> : null}
        </View>
      ))}
    </View>
  );
}

function Entries({row}: {row: ClassRow}) {
  const {color} = useTheme();
  return (
    <View style={styles.entries}>
      {row.entries.map(e => (
        <EntryLine key={e.rank} entry={e} accent={color.accent} />
      ))}
    </View>
  );
}

function EntryLine({entry, accent}: {entry: ClassEntry; accent: string}) {
  return (
    <View
      style={[
        styles.row,
        styles.entry,
        entry.player && {borderLeftColor: accent},
      ]}>
      <Text variant='dataSmall' tone='textMuted' style={styles.rank}>
        {entry.rank}
      </Text>
      <Text
        variant={entry.player ? 'dataStrong' : 'dataSmall'}
        numberOfLines={1}
        style={{flex: ENTRY_COLS.name}}>
        {entry.car ?? ''}
      </Text>
      <Text variant='dataSmall' style={[styles.num, {flex: ENTRY_COLS.best}]}>
        {formatLapTime(entry.bestS)}
      </Text>
      <Text
        variant='dataSmall'
        tone='textMuted'
        style={[styles.num, {flex: ENTRY_COLS.gap}]}>
        {entry.rank === 1 ? '' : formatGap(entry.gapS)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  table: {gap: space.xs},
  group: {borderTopWidth: 1, paddingTop: space.xs},
  row: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  num: {textAlign: 'right'},
  entries: {paddingTop: space.xs, paddingBottom: space.xs},
  entry: {
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
    paddingLeft: space.xs,
  },
  rank: {width: 24},
});
