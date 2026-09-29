import {Pressable, StyleSheet, View} from 'react-native';

import {size, space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import {type TrackCornerGroup} from '../model';

// Corner list (handoff T1 column 2, phone 05): No. | Name | Dir | Dist.
// Grouped corners sit under their section heading. Tapping a row toggles
// the selection shared with the map badges.
export function CornerList({
  groups,
  compact,
  onToggle,
}: {
  groups: TrackCornerGroup[];
  /** Desktop: 30 pt rows. Phone: 44 pt hit targets. */
  compact: boolean;
  onToggle: (n: number) => void;
}) {
  const {color} = useTheme();
  const rowH = compact ? size.cornerRowDesk : size.hit;
  return (
    <View>
      <View
        style={[
          styles.row,
          styles.header,
          {backgroundColor: color.surface, borderColor: color.lineHeader},
        ]}>
        <Text variant='tableHeader' tone='textMuted' style={styles.no}>
          No.
        </Text>
        <Text variant='tableHeader' tone='textMuted' style={styles.name}>
          Name
        </Text>
        <Text variant='tableHeader' tone='textMuted' style={styles.dir}>
          Dir
        </Text>
        <Text variant='tableHeader' tone='textMuted' style={styles.dist}>
          Dist
        </Text>
      </View>
      {groups.map((g, gi) => (
        <View key={g.title ?? `g${gi}`}>
          {g.title ? (
            <Text
              variant='tableHeader'
              tone='textMuted'
              style={styles.groupTitle}>
              {g.title}
            </Text>
          ) : null}
          {g.rows.map(r => (
            <Pressable
              key={r.n}
              accessibilityRole='button'
              accessibilityState={{selected: r.selected}}
              accessibilityLabel={`Corner ${r.n}${r.name ? `, ${r.name}` : ''}`}
              onPress={() => onToggle(r.n)}
              style={({pressed}) => [
                styles.row,
                {height: rowH, borderColor: color.line},
                r.selected && {
                  backgroundColor: color.accentTint,
                  borderLeftColor: color.accent,
                  borderLeftWidth: SELECTED_BAR,
                  paddingLeft: space.xl - SELECTED_BAR,
                },
                pressed &&
                  !r.selected && {backgroundColor: color.surfaceRaised},
              ]}>
              <Text variant='dataStrong' style={styles.no}>
                {r.n}
              </Text>
              <Text
                variant={compact ? 'body' : 'body'}
                tone={r.name ? 'text' : 'textMuted'}
                numberOfLines={1}
                style={styles.name}>
                {r.name ?? `C${r.n}`}
              </Text>
              <Text variant='dataSmall' tone='textMuted' style={styles.dir}>
                {r.turn ?? ''}
              </Text>
              <Text
                variant='dataSmall'
                tone='textSecondary'
                style={styles.dist}>
                {r.dist}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const SELECTED_BAR = 3;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  header: {paddingVertical: space.sm, borderTopWidth: 1},
  groupTitle: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.xxs,
  },
  no: {width: 26},
  name: {flex: 1, minWidth: 0},
  dir: {width: 40},
  dist: {width: 62, textAlign: 'right'},
});
