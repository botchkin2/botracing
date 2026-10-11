import {type Insets} from 'react-native';

type Grow = number | {left: number; right: number};

/**
 * Props that make a Pressable's hit area larger: `x` pt on each side
 * horizontally (or `{left, right}` when only one side has room) and `y` pt
 * vertically. It is `hitSlop`, and `Pressable` from `@/src/ui` makes that work
 * on web too (react-native-web ignores the prop), clamped so it never covers
 * another tappable's drawn box. The visible box is not touched.
 *
 * Neighbours: ask for what the control needs; the Pressable cuts it to half the
 * gap to the next control (camber, thread 27 #866).
 */
export function hitFor(x: Grow, y: number): {hitSlop: Insets} {
  const left = typeof x === 'number' ? x : x.left;
  const right = typeof x === 'number' ? x : x.right;
  return {hitSlop: {top: y, bottom: y, left, right}};
}
