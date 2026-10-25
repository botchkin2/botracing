import {describe, expect, it} from '@jest/globals';

import {type SegmentTimes} from '@/src/analysis/segments';

import {
  type SpreadBlock,
  spreadColumns,
  spreadRows as rowsOf,
  varyOf,
} from './spreadRows';

// The block of a session's basis laps with the earlier sessions `pool` lends (spreadRows.ts).
const spreadRows = (
  t: SegmentTimes | null,
  basis: ReadonlySet<string>,
  tbl: Parameters<typeof rowsOf>[2],
  pool: Parameters<typeof varyOf>[2] = [],
): SpreadBlock => rowsOf(t, basis, tbl, varyOf(t, basis, pool));

const seg = (label: string) => ({label, range: null});
const lap = (i: number, timesS: number[]) => ({
  id: `L${i}`,
  stint: 1,
  comparable: true,
  timesS,
});
// Twelve laps; S/F steady, T1 wide, T2 narrow.
const times = (): SegmentTimes => ({
  segments: [seg('S/F'), seg('T1'), seg('T2')],
  laps: Array.from({length: 12}, (_, i) =>
    lap(i, [10 + 0.01 * (i % 4), 20 + 0.4 * (i % 4), 15 + 0.1 * (i % 4)]),
  ),
});
const table = {
  heads: ['S/F', 'T1', 'T2'],
  sections: [null, 1, 2],
  targets: [
    {corner: null, whole: false},
    {corner: 3, whole: true},
    {corner: 5, whole: false},
  ],
  footer: [],
};
const all = new Set(times().laps.map(l => l.id));

describe('spreadRows', () => {
  it('biggest first, in seconds, a bar against the biggest and where a tap goes', () => {
    const {rows, line} = spreadRows(times(), all, table);
    expect(rows.map(r => r.head)).toEqual(['T1', 'T2', 'S/F']);
    expect(rows[0]).toMatchObject({
      seconds: '0.60 s',
      offs: null,
      frac: 1,
      corner: 3,
      whole: true,
    });
    expect(rows[1].frac).toBeCloseTo(0.25, 6);
    expect(rows[2].corner).toBeNull();
    expect(line).toBe('12 laps, this session');
  });

  it('reads only the basis laps; under ten of them it says how many it has', () => {
    expect(
      spreadRows(times(), new Set(['L0', 'L1', 'L2']), table),
    ).toMatchObject({
      rows: [],
      columns: [null, null, null],
      line: '3 laps: too few to say where it varies',
    });
  });

  it('is empty with no times', () => {
    expect(spreadRows(null, all, null)).toEqual({
      rows: [],
      columns: [],
      line: null,
    });
  });

  it('names a section for its wheels-off laps, ahead of the seconds, and counts them', () => {
    const t = times();
    // T2 has wheels off on 5 of the 12 laps: no time there on those.
    t.laps = t.laps.map((l, i) =>
      i < 5
        ? {
            ...l,
            timesS: [l.timesS[0], l.timesS[1], null as unknown as number],
            offs: [false, false, true],
          }
        : l,
    );
    const {rows} = spreadRows(t, all, table);
    expect(rows[0]).toMatchObject({
      head: 'T2',
      offs: 'wheels off 5 of 12 laps',
      offsShort: 'off 5/12',
      seconds: null,
      frac: 0,
    });
    expect(rows[1].head).toBe('T1');
    // The section named for its offs has no seconds at all, and its (smaller) spread does not set the others' bar scale.
    expect(rows[1].frac).toBe(1);
  });

  it('gives every section column the same cell as its row, pooled or not, so the grid and the footer say what the rows say', () => {
    const t = times();
    const block = spreadRows(t, all, table);
    for (const r of block.rows) {
      const {head, corner, whole, ...cell} = r;
      expect(
        block.columns[t.segments.findIndex(s => s.label === head)],
      ).toEqual(cell);
    }
    expect(spreadColumns(t, varyOf(t, all, []))).toEqual(block.columns);
    expect(block.columns.every(c => c?.pooled === false)).toBe(true);
  });

  it('a session short of laps takes the earlier ones it is given, and names them', () => {
    const short = times();
    short.laps = short.laps.slice(0, 8);
    const basis = new Set(short.laps.map(l => l.id));
    expect(spreadRows(short, basis, table).rows).toEqual([]);
    expect(spreadRows(short, basis, table).columns).toEqual([null, null, null]);
    const pool = [
      {
        startedAt: '2026-10-19T15:00:00Z',
        laps: times().laps.map(l => ({timesS: l.timesS})),
      },
    ];
    const {rows, columns, line} = spreadRows(short, basis, table, pool);
    expect(rows[0].head).toBe('T1');
    expect(line).toBe('20 laps: this session and Oct 19');
    // The grid's Varies row reads the same pooled seconds, and says they are pooled.
    expect(columns.map(c => c?.pooled)).toEqual([true, true, true]);
    expect(columns[1]?.seconds).toBe(rows[0].seconds);
  });
});
