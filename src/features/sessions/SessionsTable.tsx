import {useRouter} from 'expo-router';
import {useMemo, useState} from 'react';
import {FlatList, Pressable, StyleSheet, View} from 'react-native';

import {size, space, useTheme} from '@/src/design';
import {sessionHref} from '@/src/nav/routes';
import {Badge, Text} from '@/src/ui';

import {
  DEFAULT_SORT,
  nextSort,
  type SessionRow,
  type Sort,
  type SortKey,
  sortRows,
} from './model';

// The desktop Sessions list (apex, thread 44 #1898): one flat table that uses
// the width, a column per fact, sorted by date until a column head is picked.
// Rows are 32 pt as everywhere (the handoff); the phone keeps its grouped list.
const COLS: {
  key: SortKey;
  title: string;
  /** Fixed width, or flexible with this weight. */
  width?: number;
  flex?: number;
  align?: 'right';
}[] = [
  {key: 'date', title: 'Date', width: 128},
  {key: 'track', title: 'Track', flex: 1.2},
  {key: 'car', title: 'Car', flex: 1.8},
  {key: 'type', title: 'Session', width: 104},
  {key: 'class', title: 'Class', width: 72},
  {key: 'laps', title: 'Laps', width: 56, align: 'right'},
  {key: 'best', title: 'Best', width: 92, align: 'right'},
  {key: 'median', title: 'Median', width: 92, align: 'right'},
];
const BADGE_W = 24;
const HEAD_H = 36;

const cellStyle = (c: (typeof COLS)[number]) =>
  c.width != null
    ? {width: c.width}
    : {flex: c.flex ?? 1, minWidth: 0, flexBasis: 0};

export function SessionsTable({
  rows,
  width,
}: {
  rows: SessionRow[];
  width: number;
}) {
  const {color} = useTheme();
  const router = useRouter();
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  return (
    <View style={{width, flex: 1}}>
      <View
        style={[
          styles.head,
          {backgroundColor: color.surface, borderColor: color.lineHeader},
        ]}>
        <View style={{width: BADGE_W}} />
        {COLS.map(c => {
          const on = sort.key === c.key;
          return (
            <Pressable
              key={c.key}
              accessibilityRole='button'
              accessibilityState={{selected: on}}
              accessibilityLabel={`Sort by ${c.title}${
                on
                  ? `, now ${sort.dir === 'asc' ? 'ascending' : 'descending'}`
                  : ''
              }`}
              onPress={() => setSort(s => nextSort(s, c.key))}
              style={[
                styles.headCell,
                cellStyle(c),
                c.align === 'right' && styles.right,
              ]}>
              <Text variant='tableHeader' tone={on ? 'accentInk' : 'textMuted'}>
                {c.title}
                {on ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <FlatList
        data={sorted}
        keyExtractor={r => r.id}
        renderItem={({item}) => (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={[
              item.track,
              item.table.dateText,
              item.table.carText,
            ].join(', ')}
            onPress={() => router.push(sessionHref(item.id))}
            style={({pressed}) => [
              styles.row,
              {borderColor: color.line},
              pressed && {backgroundColor: color.surfaceRaised},
            ]}>
            <View style={{width: BADGE_W}}>
              <Badge label={item.badge} />
            </View>
            {COLS.map(c => (
              <Cell key={c.key} col={c} row={item} />
            ))}
          </Pressable>
        )}
      />
    </View>
  );
}

function Cell({col, row}: {col: (typeof COLS)[number]; row: SessionRow}) {
  const t = row.table;
  const text: Record<SortKey, string> = {
    date: t.dateText,
    track: row.track,
    car: t.carText,
    type: row.typeLabel,
    class: t.classText ?? '',
    laps: row.laps,
    best: row.best,
    median: row.median,
  };
  const numeric = col.align === 'right' || col.key === 'date';
  return (
    <View style={[cellStyle(col), col.align === 'right' && styles.right]}>
      <Text
        variant={numeric ? 'data' : col.key === 'track' ? 'bodyStrong' : 'body'}
        tone={col.key === 'track' ? 'text' : 'textSecondary'}
        numberOfLines={1}>
        {text[col.key]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    height: HEAD_H,
    paddingHorizontal: space.md,
    borderBottomWidth: 1,
  },
  headCell: {height: HEAD_H, justifyContent: 'center'},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    height: size.lapRow,
    paddingHorizontal: space.md,
    borderBottomWidth: 1,
  },
  right: {alignItems: 'flex-end'},
});
