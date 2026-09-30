import {describe, expect, it} from '@jest/globals';

import {type TrackCorner} from '@/src/data/sessions';

import {
  cornerView,
  dimmedRanges,
  inWindowFrame,
  overlappingLabels,
  viewCaption,
} from './stretch';

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

describe('overlap', () => {
  // Entry-to-exit spans that share track: the Bus Stop.
  const busStop = [
    {...corner(8, 3665, 3800), exitM: 3900},
    {...corner(9, 3860, 3925), exitM: 3990},
    corner(10, 4400, 4500),
  ];

  it('names the corners whose entry-to-exit span shares track', () => {
    expect(overlappingLabels(busStop, busStop[0], 5000)).toEqual(['T9']);
    expect(overlappingLabels(busStop, busStop[1], 5000)).toEqual(['T8']);
    expect(overlappingLabels(busStop, busStop[2], 5000)).toEqual([]);
  });

  it('sees an overlap across the start/finish line', () => {
    const c = [
      {...corner(1, 4950, 20), exitM: 60},
      {...corner(2, 40, 90), exitM: 150},
      {...corner(3, 4900, 4990), exitM: 4990},
    ];
    expect(overlappingLabels(c, c[0], 5000)).toEqual(['T2', 'T3']);
  });

  it('puts the overlap in the caption, and only when there is one', () => {
    expect(viewCaption('T8', {fromM: 3665, toM: 3860}, [], ['T9'])).toBe(
      'Shaded: T8 · 3,665 → 3,860 m · T8 and T9 overlap here',
    );
    expect(
      viewCaption('T8', {fromM: 3665, toM: 3860}, [], ['T9', 'T10']),
    ).toContain('T8, T9 and T10 overlap here');
    expect(cornerView(busStop, 0, [3550, 3950], 5000)!.caption).toBe(
      'Shaded: T8 · 3,665 → 3,860 m · also in view: T9 apex 3,925 m · T8 and T9 overlap here',
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

  it('dims nothing when the stretch covers the window', () => {
    expect(dimmedRanges([3700, 3800], {fromM: 3665, toM: 3860})).toEqual([]);
  });
});

describe('the stretch across the start/finish line', () => {
  const L = 4079;

  it('a corner entered before the line with its apex after it is lit in its own window (camber #942)', () => {
    // Entry 4,050, apex 60, next entry 300: the window around the apex is
    // [-190, 210] and the stretch sits at -29 -> 300.
    const cs = [corner(1, 4050, 60), corner(2, 300, 350)];
    const v = cornerView(cs, 0, [60 - 250, 60 + 150], L)!;
    expect(v.stretch).toEqual({fromM: 4050 - L, toM: 300});
    expect(dimmedRanges([-190, 210], v.stretch)).toEqual([[-190, -29]]);
    // The caption stays in lap metres.
    expect(v.caption).toContain('Shaded: T1 · 4,050 → 300 m');
  });

  it('a corner before the line whose next entry is after it runs on to toM + L', () => {
    const cs = [corner(1, 3900, 3950), corner(2, 120, 200)];
    const v = cornerView(cs, 0, [3700, 4100], L)!;
    expect(v.stretch).toEqual({fromM: 3900, toM: 120 + L});
    expect(dimmedRanges([3700, 4100], v.stretch)).toEqual([[3700, 3900]]);
  });

  it('an ordinary stretch is left where it is', () => {
    expect(inWindowFrame({fromM: 3665, toM: 3860}, [3550, 3950], L)).toEqual({
      fromM: 3665,
      toM: 3860,
    });
    expect(inWindowFrame({fromM: 3665, toM: 3860}, [3550, 3950], 0)).toEqual({
      fromM: 3665,
      toM: 3860,
    });
  });
});
