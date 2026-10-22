import {describe, expect, it} from '@jest/globals';

import {clockAt, followApp, type ChaseClock} from './chaseClock';

const playing: ChaseClock = {timeS: 100, atMs: 0, playing: true, rate: 4, appS: 100};

describe('chase clock', () => {
  it('runs at the rate while playing and holds while paused', () => {
    expect(clockAt(playing, 500)).toBeCloseTo(102);
    expect(clockAt({...playing, playing: false}, 500)).toBe(100);
  });
  it('keeps its own time when the app reports a close one (a late or early React frame)', () => {
    const c = followApp(playing, {timeS: 102.3, playing: true, rate: 4}, 500);
    expect(c).toBe(playing);
  });
  it('keeps its own time when the 5 Hz app clock is a tick behind (0.2 s of wall time, 0.8 s of race at 4x)', () => {
    // at 1000 ms the engine has run to 104; React's last tick was 0.2 s of wall time ago
    const c = followApp(playing, {timeS: 103.2, playing: true, rate: 4}, 1000);
    expect(c).toBe(playing);
  });
  it('at 16x a 5 s button step is a seek, not a glide (the threshold stops growing with the rate)', () => {
    const fast: ChaseClock = {timeS: 100, atMs: 0, playing: true, rate: 16, appS: 100};
    expect(followApp(fast, {timeS: 105, playing: true, rate: 16}, 0)).toEqual({timeS: 105, atMs: 0, playing: true, rate: 16, appS: 105});
    // and the 5 Hz tick lag at 16x (0.2 s of wall time = 3.2 s of race) is not
    expect(followApp(fast, {timeS: 100 - 3.2, playing: true, rate: 16}, 0)).toBe(fast);
  });
  it('takes the app time on a seek', () => {
    expect(followApp(playing, {timeS: 300, playing: true, rate: 4}, 500)).toEqual({timeS: 300, atMs: 500, playing: true, rate: 4, appS: 300});
  });
  it('pausing holds where the 3D had run to, not the app last tick: the cars do not step back', () => {
    // at 500 ms the engine is at 102; the app, a 5 Hz tick behind, says 101.4
    const paused = followApp(playing, {timeS: 101.4, playing: false, rate: 4}, 500);
    expect(paused.timeS).toBeCloseTo(102);
    expect(clockAt(paused, 5000)).toBeCloseTo(102);
    // the same app time arriving again changes nothing
    expect(followApp(paused, {timeS: 101.4, playing: false, rate: 4}, 900)).toBe(paused);
  });
  it('a scrub while paused is taken, even a small one; a far one too', () => {
    const paused = followApp(playing, {timeS: 101.4, playing: false, rate: 4}, 500);
    expect(followApp(paused, {timeS: 101.5, playing: false, rate: 4}, 900).timeS).toBe(101.5);
    expect(followApp(paused, {timeS: 300, playing: false, rate: 4}, 900).timeS).toBe(300);
  });
  it('resuming runs on from the held time with no jump', () => {
    const paused = followApp(playing, {timeS: 101.4, playing: false, rate: 4}, 500);
    const again = followApp(paused, {timeS: 101.4, playing: true, rate: 4}, 2000);
    expect(again.timeS).toBeCloseTo(102);
    expect(clockAt(again, 2500)).toBeCloseTo(104);
  });
  it('a pause far from the 3D time is a seek: the app time wins', () => {
    expect(followApp(playing, {timeS: 300, playing: false, rate: 4}, 500).timeS).toBe(300);
  });
  it('re-anchors on a new rate from where it had run, with no jump', () => {
    const c = followApp(playing, {timeS: 102.1, playing: true, rate: 1}, 500);
    expect(c.timeS).toBeCloseTo(102);
    expect(c.rate).toBe(1);
    expect(clockAt(c, 1500)).toBeCloseTo(103);
  });
});
