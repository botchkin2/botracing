import {useCallback, useEffect, useRef, useState} from 'react';

/**
 * A control shown on demand that hides after `idleMs` with no touch. While
 * `holdOpen` is true it stays shown; when that drops (a pause from anywhere)
 * it counts down from there, so it never vanishes at once. `reveal` shows it
 * and restarts the countdown. Nothing is stored.
 */
export function useAutoHide(idleMs: number, holdOpen: boolean) {
  const [hidden, setHidden] = useState(true);
  const [touches, setTouches] = useState(0);
  const reveal = useCallback(() => {
    setHidden(false);
    setTouches(n => n + 1);
  }, []);

  const wasHeld = useRef(holdOpen);
  useEffect(() => {
    if (wasHeld.current && !holdOpen) reveal();
    wasHeld.current = holdOpen;
  }, [holdOpen, reveal]);

  useEffect(() => {
    if (holdOpen || hidden) return;
    const timer = setTimeout(() => setHidden(true), idleMs);
    return () => clearTimeout(timer);
  }, [touches, holdOpen, hidden, idleMs]);

  return {visible: holdOpen || !hidden, reveal};
}
