import {Pressable, StyleSheet} from 'react-native';

import {radius, size, useTheme} from '@/src/design';

import {Text} from './Text';

/** 16 pt box with a 44 pt hit area. When checked it fills with `fill` (the lap's Compare color). */
export function Checkbox({
  checked,
  fill,
  onToggle,
  label,
}: {
  checked: boolean;
  fill?: string;
  onToggle: () => void;
  label: string;
}) {
  const {color} = useTheme();
  const on = fill ?? color.accent;
  return (
    <Pressable
      accessibilityRole='checkbox'
      accessibilityState={{checked}}
      accessibilityLabel={label}
      onPress={onToggle}
      hitSlop={(size.hit - size.checkbox) / 2}
      style={[
        styles.box,
        {
          borderColor: checked ? on : color.lineStrong,
          backgroundColor: checked ? on : 'transparent',
        },
      ]}>
      {checked && (
        <Text variant='label' style={[styles.tick, {color: color.bg}]}>
          ✓
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    width: size.checkbox,
    height: size.checkbox,
    borderWidth: 1.5,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: {fontSize: 10, lineHeight: 12},
});
