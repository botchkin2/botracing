import {Pressable, StyleSheet, View} from 'react-native';

import {radius, size, space, useTheme} from '@/src/design';
import {hitFor, Text} from '@/src/ui';

// "Layouts in the game" (handoff T1): the current layout is inverted; a
// tap opens that layout's Track page. Long names truncate.
export function LayoutChips({
  layouts,
  onOpen,
}: {
  layouts: {trackId: string; name: string; current: boolean}[];
  onOpen: (trackId: string) => void;
}) {
  const {color} = useTheme();
  const hit = hitFor(0, (size.hit - size.chip) / 2);
  if (layouts.length === 0) return null;
  return (
    <View style={styles.block}>
      <Text variant='tableHeader' tone='textMuted'>
        Layouts in the game
      </Text>
      <View style={styles.row}>
        {layouts.map(l => (
          <Pressable
            key={l.trackId}
            accessibilityRole='link'
            accessibilityState={{selected: l.current}}
            disabled={l.current}
            onPress={() => onOpen(l.trackId)}
            hitSlop={hit.hitSlop}
            style={[hit.style, styles.hit]}>
            <View
              style={[
                styles.chip,
                l.current
                  ? {backgroundColor: color.text, borderColor: color.text}
                  : {borderColor: color.median},
              ]}>
              <Text
                variant='body'
                numberOfLines={1}
                style={{color: l.current ? color.bg : color.text}}>
                {l.name}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {gap: space.sm},
  // Row gap 2 x the chips' 8 pt vertical hit growth, so wrapped rows never overlap.
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space.sm,
    rowGap: space.xl,
  },
  hit: {maxWidth: '100%'},
  chip: {
    height: size.chip,
    justifyContent: 'center',
    paddingHorizontal: space.md + 2,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
});
