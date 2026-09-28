import {describe, expect, it} from '@jest/globals';

import {sectionFitRange} from './sectionFit';

// A 1000 m lap cut at 200, 500 and 800 m.
const cuts = [500, 200, 800];
const fit = (a: number, b: number) => sectionFitRange(cuts, 1000, [a, b]);

describe('sectionFitRange', () => {
  it('covers the whole pieces the window touches', () => {
    expect(fit(250, 350)).toEqual([200, 500]);
    expect(fit(450, 550)).toEqual([200, 800]);
  });

  it('holds still while the window slides inside one set of pieces', () => {
    const ranges = new Set<string>();
    for (let c = 260; c <= 440; c += 5) ranges.add(fit(c - 50, c + 50).join());
    expect([...ranges]).toEqual(['200,500']);
  });

  it('changes only when an edge crosses a boundary', () => {
    const seen: string[] = [];
    for (let c = 100; c <= 900; c += 1) {
      const r = fit(c - 60, c + 60).join();
      if (seen[seen.length - 1] !== r) seen.push(r);
    }
    // Leading edge crosses 200, 500, 800; trailing edge crosses 200, 500, 800.
    expect(seen).toEqual([
      '0,200',
      '0,500',
      '200,500',
      '200,800',
      '500,800',
      '500,1000',
      '800,1000',
    ]);
  });

  it('clamps a window that runs past the line', () => {
    expect(fit(-100, 50)).toEqual([0, 200]);
    expect(fit(950, 1100)).toEqual([800, 1000]);
  });

  it('is the window itself with no sections', () => {
    expect(sectionFitRange([], 1000, [300, 400])).toEqual([300, 400]);
  });
});
