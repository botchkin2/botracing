import {Pressable, StyleSheet, View} from 'react-native';

import {radius, size, space, useTheme} from '@/src/design';
import {hitArea, Text} from '@/src/ui';

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
  const slop = (size.hit - size.chip) / 2;
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
            hitSlop={slop}
            style={[hitArea(0, slop), styles.hit]}>
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
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: space.sm},
  hit: {maxWidth: '100%'},
  chip: {
    height: size.chip,
    justifyContent: 'center',
    paddingHorizontal: space.md + 2,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
});
