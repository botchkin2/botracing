import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  loopRange,
  type TimedGrid,
  type WindowMode,
} from '@/src/analysis/window';

import {type PlayInputs, playTicker} from './playback';

/**
 * Compare's playback: the play, reverse and loop state, and the frame loop that
 * moves the cursor along the reference lap by wall-clock time (playback.ts).
 * The one place that keeps the loop's span, the latest inputs and the ticker in
 * step, so the screen only reads its state and calls its toggles.
 */
export function usePlayback({
  ref,
  rate,
  cursorM,
  move,
  windowMode,
  windowSize,
}: {
  ref: TimedGrid | null;
  rate: number;
  cursorM: number;
  move: Dispatch<SetStateAction<number>>;
  windowMode: WindowMode;
  /** The chart window in seconds or metres; null is the whole lap. */
  windowSize: number | null;
}) {
  const [playing, setPlaying] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [looping, setLooping] = useState(false);

  const live = useRef<PlayInputs>({ref, rate, reverse, move});
  const cursorNow = useRef(cursorM);
  const loopSpan = useRef<[number, number] | null>(null);
  // Effects run in this order within one commit: the cursor, then the span
  // (which reads the cursor), then the inputs (which read the span).
  useEffect(() => {
    cursorNow.current = cursorM;
  });
  // A loop repeats the stretch the window covers when playback starts (or the
  // loop is switched on), not the window as it travels with the cursor.
  useEffect(() => {
    loopSpan.current =
      looping && playing && ref
        ? loopRange(ref, cursorNow.current, windowMode, windowSize)
        : null;
  }, [looping, playing, ref, windowMode, windowSize]);
  useEffect(() => {
    live.current = {ref, rate, reverse, loop: loopSpan.current, move};
  });

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const step = playTicker(
      () => live.current,
      () => performance.now(),
    );
    const tick = () => {
      // Rewinding ends at the lap start, unless it loops.
      if (
        live.current.reverse &&
        cursorNow.current <= 0 &&
        !live.current.loop
      ) {
        setPlaying(false);
        return;
      }
      step();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  return {
    playing,
    reverse,
    looping,
    setPlaying,
    /** Play forward; pauses when it is already playing forward. */
    togglePlay: () => {
      setReverse(false);
      setPlaying(p => !p || reverse);
    },
    /** Play backward; pauses when it is already playing backward. */
    toggleReverse: () => {
      setReverse(true);
      setPlaying(p => !p || !reverse);
    },
    toggleLoop: () => setLooping(l => !l),
  };
}
