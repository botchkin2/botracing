import {type ViewStyle} from 'react-native';

/**
 * A Pressable's outer style that makes its hit area `x` / `y` pt larger on
 * each side without moving anything: padding out, margin back in. Put the
 * visible box inside. react-native-web ignores `hitSlop`, so this is what
 * gives the phone-sized web build its 44 pt targets (thread 27, 375 pt pass).
 */
export function hitArea(x: number, y: number): ViewStyle {
  return {
    paddingHorizontal: x,
    paddingVertical: y,
    marginHorizontal: -x,
    marginVertical: -y,
  };
}
