import {describe, expect, it} from '@jest/globals';

import {lapsShownText, noBrakeIn, peakIn} from './traceFacts';

// 5 m grid: index i is i × 5 m.
const flat = Array.from({length: 100}, () => 0);
const braking = flat.map((_, i) => (i >= 40 && i <= 45 ? 80 : 0));

describe('peakIn', () => {
  it('reads the peak inside the window only', () => {
    expect(peakIn([braking], [200, 225], 5)).toBe(80);
    expect(peakIn([braking], [0, 150], 5)).toBe(0);
  });
});

describe('noBrakeIn', () => {
  it('is true when every lap stays off the brake in the window', () => {
    expect(noBrakeIn([flat, flat], [150, 300], 5)).toBe(true);
  });
  it('is false as soon as one lap brakes there', () => {
    expect(noBrakeIn([flat, braking], [150, 300], 5)).toBe(false);
  });
  it('is false with no laps drawn: nothing to say yet', () => {
    expect(noBrakeIn([], [150, 300], 5)).toBe(false);
  });
});

describe('lapsShownText', () => {
  it('says how many laps are drawn, only when some are not', () => {
    expect(lapsShownText(13, 44)).toBe('13 of 44 laps');
    expect(lapsShownText(13, 13)).toBeNull();
  });
});
