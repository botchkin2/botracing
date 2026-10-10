import {memo, useEffect, useRef} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {type FieldClass} from '@/src/analysis/fieldClasses';
import {classColor, radius, size, space, useTheme} from '@/src/design';
import {Segment, Text} from '@/src/ui';

import {type CarLapsView} from '../carLapsView';
import {
  type ClassFilter,
  type RaceGroup,
  type RaceMode,
  type RaceRow,
} from '../model';
import {CarLapsPanel} from './CarLapsPanel';

// Handoff R1a: rows 32 pt on the phone, 24 pt on desktop (R1b); a 3 pt class
// bar; the car's model in place of a number (the field carries no numbers).
const CLASS_BAR_W = 3;
const CLASS_BAR_H = 14;
const POSITION_W = 22;
const GAP_W = 70;
const STATUS_W = 34;
const INSET_W = 3;
// Your row opens third from the top.
const YOU_ROW_FROM_TOP = 2;

// Memoized: the map redraws every animation frame, the rows only per sample.
export const Leaderboard = memo(function Leaderboard({
  groups,
  classes,
  filter,
  onFilter,
  onFocus,
  desktop,
  mode,
  paged,
  nearby,
  fallbackNote,
  carLaps,
}: {
  groups: RaceGroup[];
  classes: readonly FieldClass[];
  filter: ClassFilter;
  onFilter: (f: ClassFilter) => void;
  onFocus: (index: number) => void;
  desktop: boolean;
  mode: RaceMode;
  /** The list is as long as its rows and the page scrolls (the phone), not a box that scrolls inside the screen. */
  paged?: boolean;
  /** Offer the Nearby filter: the field mode, with you on the road. */
  nearby?: boolean;
  /** Said when All is shown where Nearby was asked for. */
  fallbackNote?: string | null;
  /** The focused car's laps, shown under its row; null or absent shows nothing. */
  carLaps?: {index: number; view: CarLapsView} | null;
}) {
  const {color} = useTheme();
  const rowH = desktop ? size.gridCell : size.lapRow;
  const scroll = useRef<ScrollView>(null);
  // Scroll to your row when the list changes what it lists, not per sample.
  const listKey = `${filter}:${groups.length}`;
  const youAt = groups.flatMap(g => g.rows).findIndex(r => r.player);
  useEffect(() => {
    if (paged) return;
    scroll.current?.scrollTo({
      y: Math.max(0, (youAt - YOU_ROW_FROM_TOP) * rowH),
      animated: false,
    });
    // Group headers add a little height; close enough for "third from the top".
  }, [listKey]);
  const Rows = paged ? View : ScrollView;
  return (
    <View style={paged ? undefined : styles.fill}>
      <View style={styles.filter}>
        <Segment
          options={[
            ...(nearby ? [{value: 'nearby' as const, label: 'Nearby'}] : []),
            {value: 'all', label: 'All'},
            ...classes.map(k => ({value: k.key, label: k.short})),
          ]}
          value={filter}
          onChange={onFilter}
        />
      </View>
      {fallbackNote ? (
        <Text variant='dataSmall' tone='textSecondary' style={styles.key}>
          {fallbackNote}
        </Text>
      ) : null}
      <View style={[styles.head, {borderColor: color.line}]}>
        <Text variant='tableHeader' tone='textMuted' style={styles.model}>
          Car
        </Text>
        <Text variant='tableHeader' tone='textMuted' style={styles.gap}>
          {mode === 'race' ? 'Gap' : 'Road'}
        </Text>
        <Text variant='tableHeader' tone='textMuted' style={styles.status}>
          Pit
        </Text>
      </View>
      <Rows
        {...(paged ? {} : {ref: scroll})}
        style={paged ? undefined : styles.fill}>
        {groups.map((g, i) => (
          <View key={g.title ?? `g${i}`}>
            {g.title ? (
              <Text
                variant='tableHeader'
                tone='textMuted'
                style={[
                  styles.groupTitle,
                  {backgroundColor: color.surfaceRaised},
                ]}>
                {g.title}
              </Text>
            ) : null}
            {g.rows.map(r => (
              <View key={r.index}>
                <Row row={r} height={rowH} onFocus={onFocus} />
                {carLaps?.index === r.index ? (
                  <CarLapsPanel view={carLaps.view} rowH={rowH} />
                ) : null}
              </View>
            ))}
          </View>
        ))}
      </Rows>
    </View>
  );
});

const Row = memo(function Row({
  row,
  height,
  onFocus,
}: {
  row: RaceRow;
  height: number;
  onFocus: (index: number) => void;
}) {
  const {color} = useTheme();
  const garage = row.state === 'garage';
  const where = garage
    ? 'in the garage'
    : row.position
    ? `class position ${row.position}`
    : row.gap
    ? `${row.gap} on the road`
    : 'you';
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`${row.model}, ${where}`}
      accessibilityState={{selected: row.focused}}
      onPress={() => onFocus(row.index)}
      style={[
        styles.row,
        {height},
        garage && styles.garage,
        row.player && {backgroundColor: color.surfaceRaised},
        row.focused && {backgroundColor: color.accentTint},
      ]}>
      {(row.player || row.focused) && (
        <View
          style={[
            styles.inset,
            {backgroundColor: row.focused ? color.accent : color.text},
          ]}
        />
      )}
      <Text variant='data' tone='textSecondary' style={styles.position}>
        {row.position}
      </Text>
      <View
        style={[
          styles.classBar,
          {backgroundColor: classColor(color, row.slot)},
        ]}
      />
      <Text
        variant='body'
        numberOfLines={1}
        style={styles.model}
        tone={row.player ? 'text' : 'textSecondary'}>
        {row.model}
      </Text>
      <Text variant='data' tone='text' style={styles.gap}>
        {row.gap}
      </Text>
      <Text
        variant='dataStrong'
        tone={row.state === 'pit' ? 'accentInk' : 'textSecondary'}
        style={styles.status}>
        {row.status}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  fill: {flex: 1},
  // A car in the garage is half faded (R1d).
  garage: {opacity: 0.5},
  filter: {paddingHorizontal: size.gutter, paddingVertical: space.md},
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: size.gutter,
    paddingVertical: space.xs,
    gap: space.sm,
    borderBottomWidth: 1,
  },
  key: {paddingHorizontal: size.gutter, paddingBottom: space.xs},
  groupTitle: {paddingHorizontal: size.gutter, paddingVertical: space.xs},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: size.gutter,
    gap: space.sm,
  },
  inset: {position: 'absolute', left: 0, top: 0, bottom: 0, width: INSET_W},
  position: {width: POSITION_W},
  classBar: {
    width: CLASS_BAR_W,
    height: CLASS_BAR_H,
    borderRadius: radius.xs,
  },
  model: {flex: 1},
  gap: {width: GAP_W, textAlign: 'right'},
  status: {width: STATUS_W, textAlign: 'right'},
});
