import {describe, expect, it} from '@jest/globals';

import {type TimedGrid} from '@/src/analysis/window';

import {playTicker} from './playback';

// 1000 m at a steady 50 m/s: 20 s a lap.
const ref: TimedGrid = (() => {
  const distanceM = Array.from({length: 201}, (_, i) => i * 5);
  return {stepM: 5, distanceM, timeS: distanceM.map(d => d / 50)};
})();

// React-like state: updaters queue up and apply on the next commit.
function fakeState(start: number) {
  let committed = start;
  let queue: ((c: number) => number)[] = [];
  return {
    get: () => committed,
    move: (u: number | ((c: number) => number)) => {
      queue.push(typeof u === 'function' ? u : () => u);
    },
    commit: () => {
      for (const u of queue) committed = u(committed);
      queue = [];
    },
  };
}

describe('playTicker', () => {
  it('keeps every frame when renders are slower than frames', () => {
    const s = fakeState(100);
    let t = 0;
    const tick = playTicker(
      () => ({ref, rate: 1, move: s.move}),
      () => t,
    );
    const seen: number[] = [];
    // 60 frames of 16 ms; React commits only every other frame.
    for (let i = 1; i <= 60; i++) {
      t = i * 16;
      tick();
      if (i % 2 === 0) {
        s.commit();
        seen.push(s.get());
      }
    }
    // 0.96 s at 50 m/s = 48 m, and the cursor never steps back.
    expect(s.get()).toBeCloseTo(148);
    for (let i = 1; i < seen.length; i++)
      expect(seen[i]).toBeGreaterThan(seen[i - 1]);
  });

  it('scales by rate and loops at the line', () => {
    const s = fakeState(990);
    let t = 0;
    const tick = playTicker(
      () => ({ref, rate: 2, move: s.move}),
      () => t,
    );
    t = 200;
    tick();
    s.commit();
    // 0.2 s at 2x = 0.4 s = 20 m: 990 -> 1010 -> 10 m into the next lap.
    expect(s.get()).toBeCloseTo(10);
  });

  it('caps one step, so a resume from the background does not jump', () => {
    const s = fakeState(100);
    let t = 0;
    const tick = playTicker(
      () => ({ref, rate: 1, move: s.move}),
      () => t,
    );
    t = 30_000;
    tick();
    s.commit();
    // Capped at 0.25 s = 12.5 m, not 30 s = 1.5 laps.
    expect(s.get()).toBeCloseTo(112.5);
  });

  it('does nothing without a reference lap', () => {
    const s = fakeState(100);
    const tick = playTicker(
      () => ({ref: null, rate: 1, move: s.move}),
      () => 0,
    );
    tick();
    s.commit();
    expect(s.get()).toBe(100);
  });
});

describe('playTicker reverse', () => {
  it('runs back and holds at the lap start', () => {
    const s = fakeState(100);
    let t = 0;
    const tick = playTicker(
      () => ({ref, rate: 1, reverse: true, move: s.move}),
      () => t,
    );
    t = 1000;
    tick();
    s.commit();
    expect(s.get()).toBeCloseTo(87.5, 0);
    for (let i = 0; i < 8; i++) {
      t += 250;
      tick();
      s.commit();
    }
    expect(s.get()).toBe(0);
  });
});
