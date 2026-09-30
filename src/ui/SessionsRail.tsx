import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {size, space, useTheme} from '@/src/design';

import {Badge} from './Badge';
import {Text} from './Text';

export type RailRow = {
  id: string;
  badge: string;
  /** "Road Atlanta" */
  track: string;
  /** "Race" */
  typeLabel: string;
  /** "21:40 · 44 laps" */
  railSubline: string;
  /** Formatted best lap, or a dash. */
  best: string;
};

export type RailDay = {
  key: string;
  title: string;
  date: string;
  rows: RailRow[];
};

/**
 * Desktop (≥1280) sessions rail from the handoff D1: sessions grouped by day,
 * rows 20 | 1fr | best, the open session marked with a 3 pt accent bar.
 * Props only; the route feeds it.
 */
export function SessionsRail({
  days,
  activeId,
  onSelect,
  onTracks,
  status,
}: {
  days: RailDay[];
  activeId: string | null;
  onSelect: (sessionId: string) => void;
  /** The way to the Tracks list, which has left the top bar. */
  onTracks: () => void;
  /** Shown instead of the list while loading, on error or when empty. */
  status?: string;
}) {
  const {color} = useTheme();
  return (
    <View
      style={[
        styles.rail,
        {backgroundColor: color.chrome, borderColor: color.lineHeader},
      ]}>
      <View style={[styles.head, {borderColor: color.lineHeader}]}>
        <Text variant='title'>Sessions</Text>
        <Pressable
          accessibilityRole='link'
          onPress={onTracks}
          hitSlop={space.md}>
          <Text variant='body' tone='accentInk'>
            Tracks ›
          </Text>
        </Pressable>
      </View>
      {status ? (
        <Text variant='dataSmall' tone='textMuted' style={styles.status}>
          {status}
        </Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {days.map(day => (
            <View key={day.key}>
              <View style={styles.day}>
                <Text variant='bodyStrong' style={styles.dayTitle}>
                  {day.title}
                </Text>
                <Text variant='dataSmall' tone='textFaint'>
                  {day.date}
                </Text>
              </View>
              {day.rows.map(row => (
                <RailRowView
                  key={row.id}
                  row={row}
                  active={row.id === activeId}
                  onPress={() => onSelect(row.id)}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function RailRowView({
  row,
  active,
  onPress,
}: {
  row: RailRow;
  active: boolean;
  onPress: () => void;
}) {
  const {color} = useTheme();
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{selected: active}}
      accessibilityLabel={`${row.track} ${row.typeLabel}, ${row.railSubline}`}
      onPress={onPress}
      style={({hovered, pressed}: {hovered?: boolean; pressed: boolean}) => [
        styles.row,
        (active || hovered || pressed) && {
          backgroundColor: color.surfaceRaised,
        },
      ]}>
      {active && (
        <View style={[styles.activeBar, {backgroundColor: color.accent}]} />
      )}
      <View style={styles.badge}>
        <Badge label={row.badge} />
      </View>
      <View style={styles.flex}>
        <Text variant='bodyStrong' numberOfLines={1} style={styles.track}>
          {row.track}
          <Text variant='body' tone='textMuted' style={styles.track}>
            {' · '}
            {row.typeLabel}
          </Text>
        </Text>
        <Text variant='dataSmall' tone='textMuted' numberOfLines={1}>
          {row.railSubline}
        </Text>
      </View>
      <Text variant='dataSmall' tone='textSecondary'>
        {row.best}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rail: {width: size.railWidth, borderRightWidth: 1},
  head: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  status: {padding: space.lg},
  list: {paddingBottom: space.lg},
  day: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xs,
  },
  dayTitle: {fontSize: 12.5, lineHeight: 16},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  activeBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: size.railBar,
  },
  badge: {width: size.railBadge},
  flex: {flex: 1, minWidth: 0},
  track: {fontSize: 13, lineHeight: 16},
});
