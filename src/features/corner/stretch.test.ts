import {describe, expect, it} from '@jest/globals';

import {type TrackCorner} from '@/src/data/sessions';

import {cornerView, dimmedRanges, viewCaption} from './stretch';

const corner = (
  n: number,
  entryM: number,
  apexM: number,
  official?: string,
): TrackCorner => ({
  n,
  entryM,
  apexM,
  exitM: apexM + 40,
  ...(official ? {official} : {}),
  sectionN: 1,
  sectionIndex: 0,
  partIndex: null,
  sectionLabel: 'S1 (T1)',
});

// A pair of close corners and a far one, on a 5,000 m lap.
const corners = [
  corner(1, 200, 260),
  corner(8, 3665, 3800),
  corner(9, 3860, 3925),
  corner(10, 4400, 4500),
];

describe('viewCaption', () => {
  it('names the shaded stretch and what else is in view', () => {
    expect(
      viewCaption('T8', {fromM: 3665, toM: 3860}, [{label: 'T9', lapM: 3925}]),
    ).toBe('Shaded: T8 · 3,665 → 3,860 m · also in view: T9 apex 3,925 m');
  });

  it('lists several neighbours in track order, and says nothing when there are none', () => {
    expect(
      viewCaption('T2', {fromM: 100, toM: 250}, [
        {label: 'T1', lapM: 80},
        {label: 'T3', lapM: 300},
      ]),
    ).toBe(
      'Shaded: T2 · 100 → 250 m · also in view: T1 apex 80 m, T3 apex 300 m',
    );
    expect(viewCaption('T5', {fromM: 1000, toM: 1500}, [])).toBe(
      'Shaded: T5 · 1,000 → 1,500 m',
    );
  });
});

describe('cornerView', () => {
  it('shades entry to the next entry and names the neighbour apex in the window', () => {
    const v = cornerView(corners, 1, [3550, 3950], 5000)!;
    expect(v.stretch).toEqual({fromM: 3665, toM: 3860});
    expect(v.neighbours).toEqual([
      {n: 9, label: 'T9', apexM: 3925, lapM: 3925},
    ]);
    expect(v.caption).toBe(
      'Shaded: T8 · 3,665 → 3,860 m · also in view: T9 apex 3,925 m',
    );
  });

  it('uses official labels where a track has them', () => {
    const c = [corner(9, 3520, 3520, 'T10a'), corner(10, 3575, 3575, 'T10b')];
    const v = cornerView(c, 0, [3270, 3670], 4079)!;
    expect(v.caption).toBe(
      'Shaded: T10a · 3,520 → 3,575 m · also in view: T10b apex 3,575 m',
    );
  });

  it('leaves out corners outside the window', () => {
    const v = cornerView(corners, 1, [3550, 3950], 5000)!;
    expect(v.neighbours.map(n => n.n)).toEqual([9]);
  });

  it('brings in a corner just past the start/finish line, before the line', () => {
    // T10 apex 4,500; window of T1 (apex 260) reaches back to 10.
    const v = cornerView(corners, 0, [10, 410], 5000)!;
    expect(v.neighbours).toEqual([]);
    const wrap = cornerView(
      [corner(1, 100, 160), corner(2, 4900, 4950)],
      0,
      [-90, 310],
      5000,
    )!;
    expect(wrap.neighbours).toEqual([
      {n: 2, label: 'T2', apexM: -50, lapM: 4950},
    ]);
    expect(wrap.caption).toContain('T2 apex 4,950 m');
  });

  it('is null for a corner that is not there', () => {
    expect(cornerView(corners, 9, [0, 1], 5000)).toBeNull();
  });
});

describe('dimmedRanges', () => {
  it('dims the window either side of the stretch', () => {
    expect(dimmedRanges([3550, 3950], {fromM: 3665, toM: 3860})).toEqual([
      [3550, 3665],
      [3860, 3950],
    ]);
  });

  it('dims one side when the stretch reaches an edge of the window', () => {
    expect(dimmedRanges([3550, 3950], {fromM: 3400, toM: 3860})).toEqual([
      [3860, 3950],
    ]);
    expect(dimmedRanges([3550, 3950], {fromM: 3665, toM: 4200})).toEqual([
      [3550, 3665],
    ]);
  });

  it('a stretch across the start/finish line runs to the end of the window', () => {
    expect(dimmedRanges([4800, 5200], {fromM: 4900, toM: 300})).toEqual([
      [4800, 4900],
    ]);
  });

  it('dims nothing when the stretch covers the window', () => {
    expect(dimmedRanges([3700, 3800], {fromM: 3665, toM: 3860})).toEqual([]);
  });
});
