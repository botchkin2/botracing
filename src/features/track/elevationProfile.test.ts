import {describe, expect, it} from '@jest/globals';

import {toTrackMap} from '@/src/data/sessions/adapters';

import {buildElevation, plotElevation} from './elevationProfile';

const raw = (elevation?: unknown) => ({
  trackId: 't',
  lengthM: 1000,
  corners: [
    {n: 1, entryM: 100, apexM: 150, exitM: 200, parts: []},
    // Over the line: entry near the end, exit past it.
    {n: 2, entryM: 950, apexM: 990, exitM: 40, parts: []},
  ],
  outline: {features: []},
  ...(elevation === undefined ? {} : {elevation}),
});

describe('buildElevation', () => {
  it('is null where no height is curated, or the stored one is not numbers', () => {
    expect(buildElevation(toTrackMap(raw()))).toBeNull();
    expect(buildElevation(toTrackMap(raw(null)))).toBeNull();
    expect(
      buildElevation(toTrackMap(raw({stepM: 10, heightM: [1, 'x', 3]}))),
    ).toBeNull();
    expect(
      buildElevation(toTrackMap(raw({stepM: 0, heightM: [1, 2, 3]}))),
    ).toBeNull();
    expect(buildElevation(null)).toBeNull();
  });

  it('carries the profile and each section’s window, cutting one over the line in two', () => {
    const m = buildElevation(
      toTrackMap(raw({stepM: 500, heightM: [0, 10, 0]})),
    )!;
    expect(m.lengthM).toBe(1000);
    expect(m.bands).toEqual([
      {fromM: 100, toM: 200},
      {fromM: 950, toM: 1000},
      {fromM: 0, toM: 40},
    ]);
  });
});

describe('plotElevation', () => {
  const m = buildElevation(toTrackMap(raw({stepM: 500, heightM: [0, 10, 0]})))!;
  const p = plotElevation(m, {left: 40, top: 10, plotW: 200, plotH: 100});

  it('puts the lap across the plot and a higher point higher up', () => {
    const pts = p.path
      .split(/[ML]/)
      .filter(Boolean)
      .map(s => s.trim().split(' ').map(Number));
    expect(pts).toHaveLength(3);
    expect(pts[0][0]).toBe(40);
    expect(pts[1][0]).toBe(140);
    expect(pts[2][0]).toBe(240);
    expect(pts[1][1]).toBeLessThan(pts[0][1]);
    expect(pts[0][1]).toBe(pts[2][1]);
  });

  it('shades the sections where they are, in plot x', () => {
    expect(p.bands[0]).toEqual({x: 60, width: 20});
    expect(p.bands[1]).toEqual({x: 230, width: 10});
  });

  it('ticks the metres on a 1-2-5 scale that holds the profile, and gives the lap’s ends', () => {
    expect(p.lo).toBeLessThanOrEqual(0);
    expect(p.hi).toBeGreaterThanOrEqual(10);
    expect(p.ticks.length).toBeGreaterThan(1);
    expect(p.ticks.every(t => t.label.endsWith('m'))).toBe(true);
    expect(p.endsM).toEqual([0, 1000]);
  });
});
