import {describe, expect, it} from '@jest/globals';

import {
  WINDOW_EXTRA_M,
  WINDOW_PAD_M,
  ZOOM_AFTER_M,
  ZOOM_BEFORE_M,
  zoomWindowFor,
} from './cornerWindows';

describe('zoomWindowFor', () => {
  const apex = 1000;
  const base: [number, number] = [apex - ZOOM_BEFORE_M, apex + ZOOM_AFTER_M];

  it('is the apex-based window for a corner with no window of its own', () => {
    expect(zoomWindowFor(apex, null)).toEqual(base);
  });

  it('stays the apex-based window when the corner’s window sits inside it', () => {
    expect(zoomWindowFor(apex, {fromM: 800, toM: 1100})).toEqual(base);
  });

  it('reaches the window’s edges plus the pad where the window is wider', () => {
    expect(zoomWindowFor(apex, {fromM: 650, toM: 1250})).toEqual([
      650 - WINDOW_PAD_M,
      1250 + WINDOW_PAD_M,
    ]);
  });

  it('never goes further than WINDOW_EXTRA_M past the apex-based window', () => {
    expect(zoomWindowFor(apex, {fromM: 0, toM: 5000})).toEqual([
      base[0] - WINDOW_EXTRA_M,
      base[1] + WINDOW_EXTRA_M,
    ]);
  });
});
