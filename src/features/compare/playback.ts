// Compare playback: one step per animation frame, by wall-clock time on the
// reference lap. The step is an updater on the pending cursor, never a value
// computed from the last rendered cursor: on a phone a render can outlast a
// frame, and stepping from the rendered value moves the cursor back and drops
// the elapsed time (Botkin's phone recording, pit-wall thread 26).

import type {Dispatch, SetStateAction} from 'react';

import {playStep, type TimedGrid} from '@/src/analysis/window';

export interface PlayInputs {
  ref: TimedGrid | null;
  rate: number;
  move: Dispatch<SetStateAction<number>>;
}

/** A per-frame tick. `read` returns the latest inputs; `clock` is in ms. */
export function playTicker(
  read: () => PlayInputs,
  clock: () => number,
): () => void {
  let last = clock();
  return () => {
    const now = clock();
    const dtS = (now - last) / 1000;
    last = now;
    const {ref, rate, move} = read();
    if (ref) move(c => playStep(ref, c, dtS, rate));
  };
}
