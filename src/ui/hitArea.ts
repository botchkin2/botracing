import {type Insets, Platform, type ViewStyle} from 'react-native';

type Grow = number | {left: number; right: number};

/**
 * Props that make a Pressable's hit area larger: `x` pt on each side
 * horizontally (or `{left, right}` when only one side has room) and `y` pt
 * vertically. Native uses `hitSlop`. react-native-web ignores it, so on web
 * the Pressable grows with padding and takes the same amount back as margin,
 * and the visible box goes inside it. Never both: that would double the
 * growth.
 *
 * Neighbours: the growth must not exceed half the gap to the next control, or
 * a tap near the edge lands on the later sibling (camber, thread 27 #866).
 */
export function hitFor(
  x: Grow,
  y: number,
): {style?: ViewStyle; hitSlop?: Insets} {
  const left = typeof x === 'number' ? x : x.left;
  const right = typeof x === 'number' ? x : x.right;
  if (Platform.OS !== 'web') return {hitSlop: {top: y, bottom: y, left, right}};
  return {
    style: {
      paddingLeft: left,
      paddingRight: right,
      paddingVertical: y,
      marginLeft: -left,
      marginRight: -right,
      marginVertical: -y,
    },
  };
}
