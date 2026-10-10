import {Pressable, StyleSheet, View} from 'react-native';

import {size, useLayout, useTheme} from '@/src/design';

import {Text} from './Text';

export type BottomBarItem<T extends string> = {key: T; label: string};

/**
 * Phone bar from the round 4 nav frame (item 8): text labels, an accent line
 * over the active one. Three destinations that work without an open session.
 * Data-free; the route layout feeds it.
 */
export function BottomBar<T extends string>({
  items,
  active,
  onSelect,
  bottomInset,
}: {
  items: readonly BottomBarItem<T>[];
  active: T;
  onSelect: (key: T) => void;
  bottomInset: number;
}) {
  const {color} = useTheme();
  const {isLandscapePhone, sideInset} = useLayout();
  const itemHeight = isLandscapePhone
    ? size.bottomBarLandscape
    : size.bottomBar;
  return (
    <View
      accessibilityRole='tablist'
      style={[
        styles.bar,
        {
          backgroundColor: color.surface,
          borderColor: color.lineStrong,
          paddingBottom: bottomInset,
          paddingHorizontal: sideInset,
        },
      ]}>
      {items.map(item => {
        const on = item.key === active;
        return (
          <Pressable
            key={item.key}
            accessibilityRole='tab'
            accessibilityState={{selected: on}}
            onPress={() => onSelect(item.key)}
            // 36 pt drawn, 44 pt to hit.
            hitSlop={{
              top: (size.hit - itemHeight) / 2,
              bottom: (size.hit - itemHeight) / 2,
            }}
            style={[
              styles.item,
              {height: itemHeight},
              {borderTopColor: on ? color.accent : 'transparent'},
            ]}>
            <Text variant='bodyStrong' tone={on ? 'text' : 'textMuted'}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {flexDirection: 'row', borderTopWidth: 1},
  item: {
    flex: 1,
    borderTopWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
