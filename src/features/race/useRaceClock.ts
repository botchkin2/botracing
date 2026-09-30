import {useCallback, useEffect, useRef, useState} from 'react';

import {PLAY_RATES, type PlayRate} from '@/src/state/comparePrefs';

import {stepClock} from './clock';

export type RaceTimer = {
  timeS: number;
  playing: boolean;
  rate: PlayRate;
  setTimeS: (timeS: number) => void;
  toggle: () => void;
  setRate: (rate: PlayRate) => void;
};

/**
 * Race time and playback. Each frame steps by the wall time since the last one
 * (an updater on the pending time, so a slow render never drops elapsed time:
 * the same lesson as Compare's playback, pit-wall thread 26).
 */
export function useRaceClock(endS: number, startS = 0): RaceTimer {
  const [timeS, setTimeS] = useState(startS);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<PlayRate>(1);
  const rateRef = useRef(rate);
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dtS = (now - last) / 1000;
      last = now;
      setTimeS(t => {
        const step = stepClock(t, dtS, rateRef.current, endS);
        if (step.ended) setPlaying(false);
        return step.timeS;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, endS]);

  const toggle = useCallback(() => {
    // Playing again from the end starts over.
    setTimeS(t => (t >= endS ? 0 : t));
    setPlaying(p => !p);
  }, [endS]);

  return {timeS, playing, rate, setTimeS, toggle, setRate};
}

export {PLAY_RATES};
