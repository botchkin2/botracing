import {describe, expect, it} from '@jest/globals';

import {clockAt, followApp, type ChaseClock} from './chaseClock';

const playing: ChaseClock = {timeS: 100, atMs: 0, playing: true, rate: 4};

describe('chase clock', () => {
  it('runs at the rate while playing and holds while paused', () => {
    expect(clockAt(playing, 500)).toBeCloseTo(102);
    expect(clockAt({...playing, playing: false}, 500)).toBe(100);
  });
  it('keeps its own time when the app reports a close one (a late or early React frame)', () => {
    const c = followApp(playing, {timeS: 102.3, playing: true, rate: 4}, 500);
    expect(c).toBe(playing);
  });
  it('takes the app time on a seek, and whenever paused', () => {
    expect(followApp(playing, {timeS: 300, playing: true, rate: 4}, 500)).toEqual({timeS: 300, atMs: 500, playing: true, rate: 4});
    expect(followApp(playing, {timeS: 102, playing: false, rate: 4}, 500).timeS).toBe(102);
  });
  it('re-anchors on a new rate from where it had run, with no jump', () => {
    const c = followApp(playing, {timeS: 102.1, playing: true, rate: 1}, 500);
    expect(c.timeS).toBeCloseTo(102);
    expect(c.rate).toBe(1);
    expect(clockAt(c, 1500)).toBeCloseTo(103);
  });
});
