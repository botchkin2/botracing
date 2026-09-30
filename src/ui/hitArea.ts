import {type Insets, Platform, type ViewStyle} from 'react-native';

/**
 * Props that make a Pressable's hit area `x` / `y` pt larger on each side.
 * Native uses `hitSlop`. react-native-web ignores it, so on web the Pressable
 * grows with padding and takes the same amount back as margin, and the visible
 * box goes inside it. Never both: that would double the growth.
 *
 * Neighbours: the growth must not exceed half the gap to the next control, or
 * a tap near the edge lands on the later sibling (camber, thread 27 #866).
 */
export function hitFor(
  x: number,
  y: number,
): {style?: ViewStyle; hitSlop?: Insets} {
  if (Platform.OS !== 'web')
    return {hitSlop: {top: y, bottom: y, left: x, right: x}};
  return {
    style: {
      paddingHorizontal: x,
      paddingVertical: y,
      marginHorizontal: -x,
      marginVertical: -y,
    },
  };
}
