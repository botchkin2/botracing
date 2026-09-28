import {useEffect, useRef, useState} from 'react';

// y ranges that slide to a new value over a short time instead of jumping
// (pit-wall thread 26 #381): when the section-set fit changes at a boundary,
// the traces ease into the new scale. A plain JS tween on change; ranges
// that hold still cost nothing.

type Range = [number, number];

const TWEEN_MS = 150;

const easeOut = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t);

const keyOf = (ranges: Range[]) => ranges.map(r => `${r[0]},${r[1]}`).join('|');
const rangesOf = (key: string): Range[] =>
  key === ''
    ? []
    : key.split('|').map(r => {
        const [a, b] = r.split(',').map(Number);
        return [a, b];
      });

export function useTweenedRanges(target: Range[], ms = TWEEN_MS): Range[] {
  const key = keyOf(target);
  const [shown, setShown] = useState<Range[]>(target);
  const shownRef = useRef<Range[]>(target);

  // Keyed on the ranges' content: their identity changes every render.
  useEffect(() => {
    const to = rangesOf(key);
    const from = shownRef.current;
    if (keyOf(from) === key) return;
    // A different number of ranges (a channel added or removed) snaps.
    if (from.length !== to.length) {
      shownRef.current = to;
      return;
    }
    const start = Date.now();
    let frame = 0;
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / ms);
      const k = easeOut(t);
      const next = to.map(
        (r, i): Range => [
          from[i][0] + (r[0] - from[i][0]) * k,
          from[i][1] + (r[1] - from[i][1]) * k,
        ],
      );
      shownRef.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [key, ms]);

  // Show the target when it is reached, or when the channels changed
  // (nothing to tween from); otherwise the current tween frame.
  return keyOf(shown) === key || shown.length !== target.length
    ? target
    : shown;
}
