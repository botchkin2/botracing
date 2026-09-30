import {type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {radius, size, space, useTheme} from '@/src/design';

import {hitFor} from './hitArea';
import {Text} from './Text';

/** 28 pt chip, 44 pt hit area. `selected` uses the accent border and tint. */
export function Chip({
  label,
  selected,
  dashed,
  leading,
  trailing,
  minWidth,
  onPress,
}: {
  label: string;
  selected?: boolean;
  dashed?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Wide enough to be a 44 pt target when the label is one glyph. */
  minWidth?: number;
  onPress?: () => void;
}) {
  const {color} = useTheme();
  const hit = hitFor(space.sm / 2, (size.hit - size.chip) / 2);
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{selected}}
      onPress={onPress}
      hitSlop={hit.hitSlop}
      style={[hit.style, styles.fit]}>
      <View
        style={[
          styles.chip,
          {
            minWidth,
            justifyContent: 'center',
            backgroundColor: selected ? color.accentTint : color.surfaceRaised,
            borderColor: selected ? color.accent : color.lineStrong,
            borderStyle: dashed ? 'dashed' : 'solid',
          },
        ]}>
        {leading}
        <Text variant='dataStrong' numberOfLines={1} style={styles.label}>
          {label}
        </Text>
        {trailing}
      </View>
    </Pressable>
  );
}

// A label longer than the row is cut with an ellipsis, not drawn off screen.
const styles = StyleSheet.create({
  fit: {maxWidth: '100%'},
  label: {flexShrink: 1},
  chip: {
    maxWidth: '100%',
    height: size.chip,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
});
