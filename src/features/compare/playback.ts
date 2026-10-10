// Compare playback: one step per animation frame, by wall-clock time on the
// reference lap. The step is an updater on the pending cursor, never a value
// computed from the last rendered cursor: on a phone a render can outlast a
// frame, and stepping from the rendered value moves the cursor back and drops
// the elapsed time (Botkin's phone recording, pit-wall thread 26).

import type {Dispatch, SetStateAction} from 'react';

import {PLAY_RATES, type PlayRate} from '@/src/state/comparePrefs';
import {playStep, rewindStep, type TimedGrid} from '@/src/analysis/window';

/** Longest step one tick may take, so a resume after the app was in the
 * background doesn't jump the cursor laps ahead. */
export const MAX_STEP_S = 0.25;

export interface PlayInputs {
  ref: TimedGrid | null;
  rate: number;
  /** Play backwards; stops at the lap start. */
  reverse?: boolean;
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
    const dtS = Math.min(MAX_STEP_S, (now - last) / 1000);
    last = now;
    const {ref, rate, reverse, move} = read();
    if (!ref) return;
    const advance = reverse ? rewindStep : playStep;
    move(c => advance(ref, c, dtS, rate));
  };
}

/** The speed chip's next value: 0.25, 0.5, 1, 2, then round again. An unknown
 * rate goes to 1. */
export function nextRate(rate: number): PlayRate {
  const i = (PLAY_RATES as readonly number[]).indexOf(rate);
  return i < 0 ? 1 : PLAY_RATES[(i + 1) % PLAY_RATES.length];
}
