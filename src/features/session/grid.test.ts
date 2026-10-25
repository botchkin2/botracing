import {describe, expect, test} from '@jest/globals';

import {type SegmentTimes} from '@/src/analysis/segments';

import {cornerCellOf, sessionGrid, sortRows, type GridRow} from './grid';

const seg = (label: string) => ({label, range: null});

// Two sections, five laps; L3 has no time in section 2 (a pit window).
const times = (): SegmentTimes => ({
  segments: [seg('S1'), seg('S2')],
  laps: [
    {id: 'L1', stint: 1, comparable: true, timesS: [10.0, 20.0]},
    {id: 'L2', stint: 1, comparable: true, timesS: [10.2, 20.4]},
    {id: 'L3', stint: 1, comparable: true, timesS: [10.1, null]},
    {id: 'L4', stint: 2, comparable: true, timesS: [10.4, 19.8]},
    {id: 'L5', stint: 2, comparable: false, timesS: [12.0, 25.0]},
  ],
});

const ticked = (...ids: string[]) => new Set(ids);

describe('columnStats over the ticked laps', () => {
  test('median and best come from the ticked laps only', () => {
    const g = sessionGrid(times(), ticked('L1', 'L2', 'L4'));
    // S1 ticked times: 10.0, 10.2, 10.4 → median 10.2, best 10.0
    expect(g.columns[0]).toMatchObject({n: 3, medianS: 10.2, bestS: 10.0});
    // L3 is not ticked, so S2 counts L1, L2, L4 only
    expect(g.columns[1]).toMatchObject({n: 3, medianS: 20.0, bestS: 19.8});
  });

  test('a single ticked lap is its own median, with no spread shown', () => {
    const g = sessionGrid(times(), ticked('L2'));
    expect(g.columns[0]).toMatchObject({n: 1, medianS: 10.2});
    // A median of one lap is no comparison: no gap to it, not ±0.000.
    expect(g.rows.find(r => r.lapId === 'L2')?.cells[0].deltaS).toBeNull();
  });

  test('with nothing ticked the columns are of the comparable laps, as the table under it', () => {
    const g = sessionGrid(times(), ticked());
    // L1–L4 are comparable (L5 is not); S1: 10.0, 10.1, 10.2, 10.4.
    expect(g.basisCount).toBe(4);
    expect(g.columns[0]).toMatchObject({n: 4, bestS: 10.0});
    expect(g.columns[0].medianS).toBeCloseTo(10.15, 9);
    expect(g.columns[1]).toMatchObject({n: 3, medianS: 20.0});
  });

  test('says how many laps its numbers are of', () => {
    expect(sessionGrid(times(), ticked('L1', 'L2')).basisCount).toBe(2);
  });

  test('a non-comparable lap counts when it is ticked (ticking is the selection)', () => {
    const g = sessionGrid(times(), ticked('L5'));
    expect(g.columns[0]).toMatchObject({n: 1, medianS: 12.0});
  });
});

describe('cells', () => {
  test('delta is the lap time minus the ticked median', () => {
    const g = sessionGrid(times(), ticked('L1', 'L2', 'L4'));
    const l1 = g.rows.find(r => r.lapId === 'L1')!;
    expect(l1.cells[0].deltaS).toBeCloseTo(10.0 - 10.2, 6);
  });

  test('an unticked lap is still a row, compared with the ticked median', () => {
    const g = sessionGrid(times(), ticked('L1', 'L2', 'L4'));
    const l5 = g.rows.find(r => r.lapId === 'L5')!;
    expect(l5.ticked).toBe(false);
    expect(l5.cells[0].deltaS).toBeCloseTo(12.0 - 10.2, 6);
  });

  test('a section a lap has no time for is null, never zero', () => {
    const g = sessionGrid(times(), ticked('L1', 'L2', 'L4'));
    const l3 = g.rows.find(r => r.lapId === 'L3')!;
    expect(l3.cells[1].timeS).toBeNull();
    expect(l3.cells[1].deltaS).toBeNull();
  });

  test('unit is delta over the column spread, held to ±1', () => {
    const g = sessionGrid(times(), ticked('L1', 'L2', 'L4'));
    // S1 ticked: 10.0, 10.2, 10.4 → IQR 0.2, median 10.2.
    const l5 = g.rows.find(r => r.lapId === 'L5')!;
    expect(l5.cells[0].unit).toBe(1);
    const l1 = g.rows.find(r => r.lapId === 'L1')!;
    expect(l1.cells[0].unit).toBeCloseTo(-1, 6);
    const l2 = g.rows.find(r => r.lapId === 'L2')!;
    expect(l2.cells[0].unit).toBeCloseTo(0, 6);
  });

  test('a zero spread gives unit 0, not a division by zero', () => {
    const g = sessionGrid(times(), ticked('L2'));
    expect(g.rows.every(r => r.cells[0].unit === 0)).toBe(true);
  });

  test('best marks the fastest ticked time in the section only', () => {
    const g = sessionGrid(times(), ticked('L1', 'L2', 'L4'));
    expect(g.rows.find(r => r.lapId === 'L1')!.cells[0].best).toBe(true);
    expect(g.rows.find(r => r.lapId === 'L4')!.cells[0].best).toBe(false);
  });
});

describe('cornerCellOf: a cell with no gap says why', () => {
  test('a gap is the number; wheels off is off; no time is none', () => {
    const data = times();
    // L3 has no time in S2 (a pit window); L1's S2 was left with wheels off.
    data.laps[0] = {...data.laps[0], timesS: [10.0, null], offs: [false, true]};
    const g = sessionGrid(data, ticked('L1', 'L2', 'L4'));
    const cell = (id: string, i: number) =>
      cornerCellOf(g.rows.find(r => r.lapId === id)!.cells[i]);
    expect(cell('L2', 0)).toBeCloseTo(0, 6);
    expect(cell('L1', 1)).toEqual({absent: 'off'});
    expect(cell('L3', 1)).toEqual({absent: 'none'});
  });
});

describe('stop flag', () => {
  test('a row carries the pit stop flag from its lap', () => {
    const data = times();
    data.laps[2] = {...data.laps[2], stop: true};
    const g = sessionGrid(data, ticked('L1'));
    expect(g.rows.find(r => r.lapId === 'L3')!.stop).toBe(true);
    expect(g.rows.find(r => r.lapId === 'L1')!.stop).toBe(false);
  });
});

describe('untick loops', () => {
  test('unticking a lap recomputes the medians', () => {
    const before = sessionGrid(times(), ticked('L1', 'L2', 'L4'));
    const after = sessionGrid(times(), ticked('L1', 'L4'));
    expect(before.columns[0].medianS).toBe(10.2);
    expect(after.columns[0].medianS).toBeCloseTo((10.0 + 10.4) / 2, 6);
  });
});

describe('sorting', () => {
  test('lap order is the default and keeps every row', () => {
    const g = sessionGrid(times(), ticked('L1'));
    expect(g.rows.map(r => r.lapId)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5']);
  });

  test('a column sorts by its time, fastest first, laps without a time last', () => {
    const g = sessionGrid(times(), ticked('L1'), {
      kind: 'column',
      index: 1,
      dir: 'asc',
    });
    expect(g.rows.map(r => r.lapId)).toEqual(['L4', 'L1', 'L2', 'L5', 'L3']);
  });

  test('a descending sort is stable for equal times', () => {
    const rows: GridRow[] = [
      {
        lapId: 'A',
        label: 'A',
        stint: 1,
        stop: false,
        ticked: true,
        cells: [{timeS: 5, deltaS: null, unit: 0, best: false, off: false}],
      },
      {
        lapId: 'B',
        label: 'B',
        stint: 1,
        stop: false,
        ticked: true,
        cells: [{timeS: 5, deltaS: null, unit: 0, best: false, off: false}],
      },
    ];
    const out = sortRows(rows, {kind: 'column', index: 0, dir: 'desc'});
    expect(out.map(r => r.lapId)).toEqual(['A', 'B']);
  });
});
