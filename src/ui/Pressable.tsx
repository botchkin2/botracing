import {forwardRef} from 'react';
import {
  Platform,
  Pressable as RNPressable,
  type PressableProps,
  type View,
  View as RNView,
} from 'react-native';

import {pressedOpacity} from '@/src/design';

type Slop = {top: number; bottom: number; left: number; right: number};

function slopOf(hitSlop: PressableProps['hitSlop']): Slop | null {
  if (hitSlop == null) return null;
  if (typeof hitSlop === 'number')
    return {top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop};
  return {
    top: hitSlop.top ?? 0,
    bottom: hitSlop.bottom ?? 0,
    left: hitSlop.left ?? 0,
    right: hitSlop.right ?? 0,
  };
}

/**
 * The app's Pressable: react-native's, plus two things every tappable needs.
 *
 * - One visible pressed state (Theme G): it dims while a finger is on it. A
 *   disabled one does not change. Its own `style`, object, array or function
 *   of the press state, applies first.
 * - `hitSlop` that works on web. react-native-web ignores the prop and the
 *   phone build is often the web one, so there an invisible box, as far past
 *   the edges as the slop asks, sits inside the Pressable: a tap on it is a
 *   tap on the Pressable and nothing is laid out differently.
 */
export const Pressable = forwardRef<View, PressableProps>(function Pressable(
  {style, disabled, hitSlop, children, ...rest},
  ref,
) {
  const slop = Platform.OS === 'web' ? slopOf(hitSlop) : null;
  const overlay = slop ? (
    <RNView
      pointerEvents='box-only'
      style={{
        position: 'absolute',
        top: -slop.top,
        bottom: -slop.bottom,
        left: -slop.left,
        right: -slop.right,
      }}
    />
  ) : null;
  return (
    <RNPressable
      ref={ref}
      disabled={disabled}
      hitSlop={Platform.OS === 'web' ? undefined : hitSlop}
      {...rest}
      style={state => [
        typeof style === 'function' ? style(state) : style,
        state.pressed && !disabled ? {opacity: pressedOpacity} : null,
      ]}>
      {overlay
        ? state => (
            <>
              {typeof children === 'function' ? children(state) : children}
              {overlay}
            </>
          )
        : children}
    </RNPressable>
  );
});
