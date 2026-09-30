import {Pressable, StyleSheet, View} from 'react-native';
import Svg, {Path} from 'react-native-svg';

import {radius, size, useTheme} from '@/src/design';

import {hitArea} from './hitArea';

// 44 pt wide, but only as tall as a 32 pt lap row: taller would overlap the
// rows above and below (design call in thread 27).
const WIDTH_SLOP = (size.hit - size.checkbox) / 2;
const HEIGHT_SLOP = (size.lapRow - size.checkbox) / 2;

/** 16 pt box with a 44 pt wide hit area. When checked it fills with `fill` (the lap's Compare color). */
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
      style={hitArea(WIDTH_SLOP, HEIGHT_SLOP)}>
      <View
        style={[
          styles.box,
          {
            borderColor: checked ? on : color.lineStrong,
            backgroundColor: checked ? on : 'transparent',
          },
        ]}>
        {checked && (
          <Svg width={10} height={10} viewBox='0 0 10 10'>
            <Path
              d='M1.5 5.2 L4 7.6 L8.6 2.4'
              stroke={color.bg}
              strokeWidth={1.8}
              fill='none'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          </Svg>
        )}
      </View>
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
});
