import {describe, expect, it} from '@jest/globals';

import {createPageScroll, maxScrollY, nextScrollY, SETTLE_MS} from './pageScroll';

describe('nextScrollY', () => {
  it('a finger moving up (negative dy) scrolls the page down, and the reverse', () => {
    expect(nextScrollY(100, -30, 1000)).toBe(130);
    expect(nextScrollY(100, 30, 1000)).toBe(70);
  });
  it('stays inside the page', () => {
    expect(nextScrollY(10, 50, 1000)).toBe(0);
    expect(nextScrollY(990, -50, 1000)).toBe(1000);
    expect(nextScrollY(0, -50, 0)).toBe(0);
    expect(nextScrollY(5, -50, -20)).toBe(0);
  });
  it('a value that is not a number moves nothing', () => {
    expect(nextScrollY(100, Number.NaN, 1000)).toBe(100);
    expect(nextScrollY(100, Infinity, 1000)).toBe(100);
  });
  it('is finite for any offset the page reports', () => {
    for (const y of [0, 0.5, 1e6, -3]) for (const dy of [0, 1e-9, -1000, 1000]) expect(Number.isFinite(nextScrollY(y, dy, 800))).toBe(true);
  });
});

describe('maxScrollY', () => {
  it('is the content less the window, and never negative', () => {
    expect(maxScrollY(2400, 800)).toBe(1600);
    expect(maxScrollY(600, 800)).toBe(0);
  });
});

describe('createPageScroll: the ScrollView lags the pans it is sent', () => {
  const page = () => {
    const p = createPageScroll();
    p.size(2400, 800);
    return p;
  };

  it('pans accumulate from the offset the last pan set, not from what the ScrollView has reported yet', () => {
    const p = page();
    expect(p.pan(-40, 0)).toBe(40);
    p.reported(0, 5); // the ScrollView still says 0: it has not applied the first scrollTo
    expect(p.pan(-40, 16)).toBe(80);
    p.reported(40, 20); // and now the first one lands
    expect(p.pan(-40, 32)).toBe(120);
  });

  it('a report inside the window after the last pan is ignored, however late', () => {
    const p = page();
    p.pan(-100, 1000);
    p.reported(10, 1000 + SETTLE_MS);
    expect(p.offset).toBe(100);
    expect(p.pan(-10, 1000 + SETTLE_MS)).toBe(110);
  });

  it('a report after the window is believed: the user scrolled the page somewhere else', () => {
    const p = page();
    p.pan(-100, 1000);
    p.reported(600, 1000 + SETTLE_MS + 1);
    expect(p.offset).toBe(600);
    expect(p.pan(-10, 2000)).toBe(610);
  });

  it('a fling that stops, then a native scroll, then a pan starts from the native position', () => {
    const p = page();
    p.pan(-30, 0);
    p.reported(30, 300);
    p.reported(500, 400);
    expect(p.pan(20, 410)).toBe(480);
  });

  it('stays inside the page it was told the size of', () => {
    const p = page();
    expect(p.pan(500, 0)).toBe(0);
    expect(p.pan(-5000, 16)).toBe(1600);
  });
});
