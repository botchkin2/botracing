import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';
import {useState} from 'react';
import {act, create} from 'react-test-renderer';

import {type TimedGrid} from '@/src/analysis/window';

import {usePlayback} from './usePlayback';

// 1000 m at a steady 50 m/s: 20 s a lap.
const ref: TimedGrid = (() => {
  const distanceM = Array.from({length: 201}, (_, i) => i * 5);
  return {stepM: 5, distanceM, timeS: distanceM.map(d => d / 50)};
})();

let now = 0;
let frames: (() => void)[] = [];
beforeEach(() => {
  now = 0;
  frames = [];
  jest.spyOn(performance, 'now').mockImplementation(() => now);
  globalThis.requestAnimationFrame = ((cb: () => void) => {
    frames.push(cb);
    return frames.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});
afterEach(() => {
  jest.restoreAllMocks();
});

function mount(startM: number) {
  const out: {api: ReturnType<typeof usePlayback>; cursor: number} = {
    api: null as never,
    cursor: startM,
  };
  // The cursor is state, as on the screen: a move re-renders the hook.
  function Probe() {
    const [cursor, setCursor] = useState(startM);
    out.cursor = cursor;
    out.api = usePlayback({
      ref,
      rate: 1,
      cursorM: cursor,
      move: setCursor,
      windowMode: 'time',
      windowSize: 4,
    });
    return null;
  }
  act(() => {
    create(<Probe />);
  });
  return out;
}

// One animation frame: advance the clock 16 ms, run what was asked for.
function frame() {
  now += 16;
  const run = frames;
  frames = [];
  act(() => run.forEach(f => f()));
}

describe('usePlayback', () => {
  it('plays on past the window when Loop is off', () => {
    const p = mount(500);
    act(() => p.api.togglePlay());
    for (let i = 0; i < 200; i++) frame();
    // ~3.2 s at 50 m/s from 500 m: well past a 4 s window (400 to 600 m).
    expect(p.cursor).toBeGreaterThan(600);
  });

  it('repeats the window that was showing when playback started when Loop is on', () => {
    const p = mount(500);
    act(() => p.api.toggleLoop());
    act(() => p.api.togglePlay());
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 600; i++) {
      frame();
      min = Math.min(min, p.cursor);
      max = Math.max(max, p.cursor);
    }
    // A 4 s window around 500 m (10 s) is 8 to 12 s: 400 to 600 m.
    expect(min).toBeGreaterThanOrEqual(400 - 1e-6);
    expect(max).toBeLessThanOrEqual(600 + 1e-6);
    expect(max - min).toBeGreaterThan(150);
  });

  it('stops a reverse play at the lap start when Loop is off', () => {
    const p = mount(30);
    act(() => p.api.toggleReverse());
    for (let i = 0; i < 200; i++) frame();
    expect(p.cursor).toBe(0);
    expect(p.api.playing).toBe(false);
  });
});
