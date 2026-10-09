import {Pressable, StyleSheet, View} from 'react-native';

import {size, space, useTheme, turnLabel, turnNumber} from '@/src/design';
import {Text} from '@/src/ui';

import {type TrackCornerGroup} from '../model';

// Corner picker (handoff T1 column 2, phone 05): one line per corner, its turn
// name or the turn label. Grouped corners sit under their section heading.
// Tapping a row toggles the selection shared with the map badges.
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
              accessibilityLabel={`${turnLabel(r.n, r.official ?? undefined)}${
                r.name ? `, ${r.name}` : ''
              }`}
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
              <Text
                variant='body'
                tone={r.name ? 'text' : 'textMuted'}
                numberOfLines={1}
                style={styles.name}>
                {r.name ?? turnLabel(r.n, r.official ?? undefined)}
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
  groupTitle: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.xxs,
  },
  name: {flex: 1, minWidth: 0},
});
