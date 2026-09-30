import {Pressable, StyleSheet, View} from 'react-native';

import {radius, size, space, useTheme} from '@/src/design';

import {Text} from './Text';

export type SessionTabItem<T extends string> = {key: T; label: string};

/**
 * Laps / Compare / Corner / Race as one full-width segmented row (round 4
 * nav frame, item 8). Each segment is a 44 pt target. Data-free.
 */
export function SessionTabs<T extends string>({
  items,
  active,
  onSelect,
}: {
  items: readonly SessionTabItem<T>[];
  active: T;
  onSelect: (key: T) => void;
}) {
  const {color} = useTheme();
  return (
    <View
      accessibilityRole='tablist'
      style={[styles.row, {borderColor: color.lineStrong}]}>
      {items.map(item => {
        const on = item.key === active;
        return (
          <Pressable
            key={item.key}
            accessibilityRole='tab'
            accessibilityState={{selected: on}}
            onPress={() => onSelect(item.key)}
            style={[styles.option, on && {backgroundColor: color.accentTint}]}>
            <Text variant='dataStrong' tone={on ? 'accentInk' : 'textMuted'}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.sm,
    marginHorizontal: size.gutter,
    marginVertical: space.sm,
  },
  option: {
    flex: 1,
    height: size.hit,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.xs,
  },
});
