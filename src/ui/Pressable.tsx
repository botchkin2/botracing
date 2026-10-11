import {forwardRef, useCallback, useEffect, useRef, useState} from 'react';
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

const TAPPABLE =
  '[role=button],[role=tab],[role=link],[role=checkbox],[role=switch],[role=radio],button,a[href],[data-focusable=true]';

/**
 * The slop a Pressable may really have: what it asked for, cut on each side to
 * half the gap to the next tappable there (the neighbour keeps its half), and
 * to nothing where another tappable's drawn box touches or overlaps. Slop grows
 * toward empty space only; it never takes a tap from a control drawn there.
 */
export function clampSlop(
  rect: {left: number; right: number; top: number; bottom: number},
  asked: Slop,
  others: {left: number; right: number; top: number; bottom: number}[],
): Slop {
  const out = {...asked};
  for (const o of others) {
    const acrossY = o.top < rect.bottom && o.bottom > rect.top;
    const acrossX = o.left < rect.right && o.right > rect.left;
    if (acrossX && acrossY) {
      // Drawn boxes overlap: no slop toward the one that is there.
      if (o.left + o.right < rect.left + rect.right) out.left = 0;
      else out.right = 0;
      if (o.top + o.bottom < rect.top + rect.bottom) out.top = 0;
      else out.bottom = 0;
      continue;
    }
    if (acrossY && o.left >= rect.right)
      out.right = Math.min(out.right, Math.max(0, (o.left - rect.right) / 2));
    if (acrossY && o.right <= rect.left)
      out.left = Math.min(out.left, Math.max(0, (rect.left - o.right) / 2));
    if (acrossX && o.top >= rect.bottom)
      out.bottom = Math.min(out.bottom, Math.max(0, (o.top - rect.bottom) / 2));
    if (acrossX && o.bottom <= rect.top)
      out.top = Math.min(out.top, Math.max(0, (rect.top - o.bottom) / 2));
  }
  return out;
}

/**
 * The app's Pressable: react-native's, plus two things every tappable needs.
 *
 * - One visible pressed state (Theme G): it dims while a finger is on it. A
 *   disabled one does not change. Its own `style`, object, array or function
 *   of the press state, applies first.
 * - `hitSlop` that works on web. react-native-web ignores the prop and the
 *   phone build is often the web one, so there an invisible box sits inside the
 *   Pressable, past its edges by the slop, and a tap on it is a tap on the
 *   Pressable. The slop is clamped (`clampSlop`) so it never covers another
 *   tappable's drawn box. A slop box cannot pass a clipping parent: a control
 *   in a scroller needs a real 44 pt box.
 */
export const Pressable = forwardRef<View, PressableProps>(function Pressable(
  {style, disabled, hitSlop, children, onLayout, ...rest},
  ref,
) {
  const asked = Platform.OS === 'web' ? slopOf(hitSlop) : null;
  const node = useRef<View | null>(null);
  // None until measured: before that a neighbour's box is not known.
  const [slop, setSlop] = useState<Slop | null>(null);
  const askedKey = asked
    ? `${asked.top},${asked.bottom},${asked.left},${asked.right}`
    : '';
  const measure = useCallback(() => {
    if (!asked) return;
    const el = node.current as unknown as HTMLElement | null;
    if (!el || typeof el.getBoundingClientRect !== 'function') return;
    const rect = el.getBoundingClientRect();
    const others = [...document.querySelectorAll(TAPPABLE)]
      .filter(o => o !== el && !el.contains(o) && !o.contains(el))
      .map(o => o.getBoundingClientRect())
      .filter(b => b.width > 0 && b.height > 0);
    const next = clampSlop(rect, asked, others);
    setSlop(prev =>
      prev &&
      prev.top === next.top &&
      prev.bottom === next.bottom &&
      prev.left === next.left &&
      prev.right === next.right
        ? prev
        : next,
    );
    // `asked` is rebuilt every render; its values, askedKey, are what matter.
  }, [askedKey]);
  useEffect(() => {
    if (!asked) return;
    // Neighbours mount in the same pass: measure once they have laid out.
    const id = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(id);
  }, [askedKey, measure]);
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
      ref={el => {
        node.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      disabled={disabled}
      hitSlop={Platform.OS === 'web' ? undefined : hitSlop}
      onLayout={e => {
        measure();
        onLayout?.(e);
      }}
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
