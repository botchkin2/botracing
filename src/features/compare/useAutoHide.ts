import {useCallback, useEffect, useState} from 'react';

import {scheduleHide} from './autoHide';

/**
 * A control that is shown on demand and hides after `idleMs` with no touch.
 * `holdOpen` keeps it shown (while playing). `reveal` shows it and restarts
 * the countdown. Nothing is stored.
 */
export function useAutoHide(idleMs: number, holdOpen: boolean) {
  const [hidden, setHidden] = useState(true);
  const [touches, setTouches] = useState(0);
  const reveal = useCallback(() => {
    setHidden(false);
    setTouches(n => n + 1);
  }, []);
  useEffect(() => {
    if (holdOpen || hidden) return;
    return scheduleHide(idleMs, () => setHidden(true));
  }, [touches, holdOpen, hidden, idleMs]);
  return {visible: holdOpen || !hidden, reveal};
}
