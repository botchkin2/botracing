import {useIsFocused} from 'expo-router';
import {useEffect, useRef} from 'react';

import {type RaceTimer} from './useRaceClock';

/**
 * Race stays mounted under the screen that was opened over it (the tab row's Race goes back to it, so its 3D is never
 * rebuilt), so while it is covered its clock rests, and the 3D with it. When Race is on top again the clock goes on from
 * the same moment if it was playing. Returns whether Race is the screen on top: `router.setParams` writes to that one.
 */
export function useRestWhileAway({playing, setPlaying}: Pick<RaceTimer, 'playing' | 'setPlaying'>): boolean {
  const focused = useIsFocused();
  const wasPlaying = useRef(false);
  const latest = useRef(playing);
  useEffect(() => {
    latest.current = playing;
  });
  useEffect(() => {
    if (focused) {
      if (wasPlaying.current) setPlaying(true);
      wasPlaying.current = false;
    } else {
      wasPlaying.current = latest.current;
      setPlaying(false);
    }
  }, [focused, setPlaying]);
  return focused;
}
