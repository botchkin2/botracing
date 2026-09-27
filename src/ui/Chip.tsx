import {type ReactNode} from 'react';
import {Pressable, StyleSheet} from 'react-native';

import {radius, size, space, useTheme} from '@/src/design';

import {Text} from './Text';

/** 28 pt chip, 44 pt hit area. `selected` uses the accent border and tint. */
export function Chip({
  label,
  selected,
  dashed,
  leading,
  trailing,
  onPress,
}: {
  label: string;
  selected?: boolean;
  dashed?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
}) {
  const {color} = useTheme();
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{selected}}
      onPress={onPress}
      hitSlop={(size.hit - size.chip) / 2}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? color.accentTint : color.surfaceRaised,
          borderColor: selected ? color.accent : color.lineStrong,
          borderStyle: dashed ? 'dashed' : 'solid',
        },
      ]}>
      {leading}
      <Text variant='dataStrong'>{label}</Text>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: size.chip,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
});
