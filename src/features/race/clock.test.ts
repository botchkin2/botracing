import {describe, expect, it} from '@jest/globals';

import {
  clockLabel,
  MAX_STEP_S,
  RACE_RATES,
  snapClock,
  stepClock,
} from './clock';

describe('stepClock', () => {
  it('advances by wall time at the rate', () => {
    expect(stepClock(10, 0.1, 2, 100)).toEqual({timeS: 10.2, ended: false});
    expect(stepClock(10, 0.1, 0.25, 100).timeS).toBeCloseTo(10.025, 9);
  });

  it('has the rates a 15 to 60 minute race needs, up to 16x', () => {
    expect([...RACE_RATES]).toEqual([0.25, 0.5, 1, 2, 4, 8, 16]);
    // One frame at 16x moves 4 s of race at most (0.25 s of wall time).
    expect(stepClock(10, 1, 16, 1000).timeS).toBeCloseTo(
      10 + MAX_STEP_S * 16,
      9,
    );
    // A 60 fps frame at 16x is 0.27 s of race: more than one 5 Hz update.
    expect(stepClock(10, 1 / 60, 16, 1000).timeS - 10).toBeCloseTo(16 / 60, 9);
  });

  it('caps a long step, e.g. after the app was in the background', () => {
    expect(stepClock(10, 30, 1, 100).timeS).toBeCloseTo(10 + MAX_STEP_S, 9);
  });

  it('stops at the end and says so', () => {
    expect(stepClock(99.9, 0.2, 1, 100)).toEqual({timeS: 100, ended: true});
  });

  it('never goes backwards on a negative step', () => {
    expect(stepClock(10, -1, 1, 100).timeS).toBe(10);
  });
});

describe('snapClock', () => {
  it('rests on the nearest 0.2 s update at 5 Hz', () => {
    expect(snapClock(10.29, 5)).toBeCloseTo(10.2, 9);
    expect(snapClock(10.31, 5)).toBeCloseTo(10.4, 9);
  });

  it('leaves time alone without a rate', () => {
    expect(snapClock(10.29, 0)).toBe(10.29);
  });
});

describe('clockLabel', () => {
  it('reads m:ss.s', () => {
    expect(clockLabel(0)).toBe('0:00.0');
    expect(clockLabel(83.44)).toBe('1:23.4');
    expect(clockLabel(1283.4)).toBe('21:23.4');
    expect(clockLabel(59.96)).toBe('1:00.0');
    expect(clockLabel(-3)).toBe('0:00.0');
  });
});
