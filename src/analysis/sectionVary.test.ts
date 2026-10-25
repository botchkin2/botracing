import {describe, expect, it} from '@jest/globals';

import {
  MIN_POOLED_SESSION_LAPS,
  type PooledSession,
  sectionVary,
  type VaryLap,
} from './sectionVary';

// A column of n times with a chosen IQR: equal steps, centred on `centre`.
const column = (n: number, iqrS: number, centre = 60): number[] => {
  const step = iqrS / ((n - 1) / 2);
  return Array.from({length: n}, (_, i) => centre + (i - (n - 1) / 2) * step);
};

// Laps from per-section columns; a null in a column is a window that does not count.
const lapsOf = (cols: (number | null)[][], offs: boolean[][] = []): VaryLap[] =>
  cols[0].map((_, k) => ({
    timesS: cols.map(c => c[k]),
    offs: cols.map((_c, i) => offs[i]?.[k] === true),
  }));

describe('sectionVary on one session of 12 laps', () => {
  // T2-4 is blank on 5 of 12 laps for wheels off, T5 spreads 0.36 s, T6-7 0.26 s.
  const cols = [
    [...column(7, 0.4), null, null, null, null, null],
    column(12, 0.36),
    column(12, 0.26),
  ];
  const offs = [
    [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      true,
    ],
  ];
  const own = lapsOf(cols, offs);

  it('names the section with wheels off first, with its count, then the seconds', () => {
    const v = sectionVary(own, [], 3)!;
    expect(v.rows.map(r => r.index)).toEqual([0, 1, 2]);
    expect(v.rows[0]).toMatchObject({
      offLaps: 5,
      ownLaps: 12,
      offsFirst: true,
      pooled: false,
    });
    expect(v.rows[1].spreadS).toBeCloseTo(0.36, 6);
    expect(v.rows[2].spreadS).toBeCloseTo(0.26, 6);
    expect(v).toMatchObject({ownLaps: 12, pooledLaps: 0, pooledFrom: []});
  });

  it('a section with too few laps for a spread is still named for its wheels-off laps', () => {
    const v = sectionVary(own, [], 3)!;
    expect(v.rows[0].spreadS).toBeNull();
    expect(v.rows[0].n).toBe(7);
  });
});

describe('sectionVary offs-first needs laps and share', () => {
  const rowsFor = (offCount: number, total: number) => {
    const times = [
      ...column(total - offCount, 0.3),
      ...Array(offCount).fill(null),
    ];
    const offs = [
      ...Array(total - offCount).fill(false),
      ...Array(offCount).fill(true),
    ];
    return sectionVary(lapsOf([times, column(total, 0.2)], [offs]), [], 2)!
      .rows;
  };

  it('3 laps at 21 % is named first, 3 laps at 19 % is not', () => {
    // 3 of 14 laps: 21.4 %; 3 of 16: 18.75 %
    expect(rowsFor(3, 14)[0]).toMatchObject({index: 0, offsFirst: true});
    expect(rowsFor(3, 16).some(r => r.offsFirst)).toBe(false);
  });

  it('2 laps at 25 % is not named first', () => {
    // 12 laps; section 0 counts on 6, has wheels off on 2 (2 of 8 = 25 %) and is blank on 4 for other reasons
    const times = [...column(6, 0.3), null, null, null, null, null, null];
    const offs = [...Array(6).fill(false), true, true, ...Array(4).fill(false)];
    const v = sectionVary(lapsOf([times, column(12, 0.2)], [offs]), [], 2)!;
    expect(v.rows.some(r => r.offsFirst)).toBe(false);
  });
});

describe('sectionVary pooling', () => {
  const nine = lapsOf([column(9, 0.3), column(9, 0.5)]);
  const day = (
    offset: number,
    spread: number,
    startedAt = '2026-10-19T01:00:00Z',
    n = 12,
  ): PooledSession => ({
    startedAt,
    laps: lapsOf([
      column(n, spread, 60 + offset),
      column(n, spread, 90 + offset),
    ]),
  });

  it('9 laps alone is null; pooled with a 12-lap session it is ranked, naming the session', () => {
    expect(sectionVary(nine, [], 2)).toBeNull();
    const v = sectionVary(nine, [day(0, 0.3)], 2)!;
    expect(v.rows).toHaveLength(2);
    expect(v.rows.every(r => r.pooled)).toBe(true);
    expect(v).toMatchObject({
      ownLaps: 9,
      pooledLaps: 12,
      pooledFrom: ['2026-10-19T01:00:00Z'],
    });
  });

  it('a day-to-day offset of 1 s adds no spread', () => {
    const same = sectionVary(nine, [day(0, 0.3)], 2)!.rows.map(r => r.spreadS);
    const shifted = sectionVary(nine, [day(1, 0.3)], 2)!.rows.map(
      r => r.spreadS,
    );
    expect(shifted).toEqual(same);
  });

  it('a pooled session of fewer than 3 laps in a section cannot lower its seconds', () => {
    const base = sectionVary(nine, [day(0, 0.6)], 2)!;
    const oneLap: PooledSession = {
      startedAt: '2026-10-20T01:00:00Z',
      laps: lapsOf([[60], [90]]),
    };
    const twoLaps: PooledSession = {
      startedAt: '2026-10-21T01:00:00Z',
      laps: lapsOf([
        [60, 60],
        [90, 90],
      ]),
    };
    const withShort = sectionVary(nine, [day(0, 0.6), oneLap, twoLaps], 2)!;
    expect(withShort.rows.map(r => r.spreadS)).toEqual(
      base.rows.map(r => r.spreadS),
    );
    expect(withShort.pooledFrom).toEqual(['2026-10-19T01:00:00Z']);
    expect(MIN_POOLED_SESSION_LAPS).toBe(3);
  });

  it('under 10 laps even pooled is null', () => {
    expect(
      sectionVary(
        lapsOf([column(4, 0.3)]),
        [day(0, 0.3, '2026-10-19T01:00:00Z', 4)],
        1,
      ),
    ).toBeNull();
  });
});
