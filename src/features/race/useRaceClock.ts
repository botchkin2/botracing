import {useCallback, useEffect, useRef, useState} from 'react';

import {type RaceRate, stepClock} from './clock';

export type RaceTimer = {
  timeS: number;
  playing: boolean;
  rate: RaceRate;
  setTimeS: (timeS: number) => void;
  /** Play or pause by value (the app's clock arrives as a state, not a toggle). */
  setPlaying: (playing: boolean) => void;
  toggle: () => void;
  setRate: (rate: RaceRate) => void;
};

/**
 * Race time and playback. `tickHz` (> 0) hands React the clock that often instead of every frame. Each frame steps by the wall time since the last one
 * (an updater on the pending time, so a slow render never drops elapsed time:
 * the same lesson as Compare's playback, pit-wall thread 26).
 */
export function useRaceClock(endS: number, startS = 0, tickHz = 0): RaceTimer {
  const [timeS, setTimeS] = useState(startS);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<RaceRate>(1);
  const rateRef = useRef(rate);
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    // tickHz > 0: React sees the clock that often, not every frame (the 3D draws from its own clock, so a render per
    // frame is cost with nothing to show; thread 94 #6473)
    const everyMs = tickHz > 0 ? 1000 / tickHz : 0;
    const tick = () => {
      const now = performance.now();
      if (now - last >= everyMs) {
        const dtS = (now - last) / 1000;
        last = now;
        setTimeS(t => {
          const step = stepClock(t, dtS, rateRef.current, endS, tickHz > 0 ? 2 / tickHz : undefined);
          if (step.ended) setPlaying(false);
          return step.timeS;
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, endS, tickHz]);

  const toggle = useCallback(() => {
    // Playing again from the end starts over.
    setTimeS(t => (t >= endS ? 0 : t));
    setPlaying(p => !p);
  }, [endS]);

  return {timeS, playing, rate, setTimeS, setPlaying, toggle, setRate};
}
