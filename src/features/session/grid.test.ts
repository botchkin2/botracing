import {describe, expect, test} from '@jest/globals';

import {type SegmentTimes} from '@/src/analysis/segments';

import {sessionGrid, sortRows, type GridRow} from './grid';

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

  test('a single ticked lap is its own median, with no spread', () => {
    const g = sessionGrid(times(), ticked('L2'));
    expect(g.columns[0]).toMatchObject({n: 1, medianS: 10.2, spreadS: 0});
  });

  test('no ticked laps leaves every column empty', () => {
    const g = sessionGrid(times(), ticked());
    expect(g.columns.map(c => c.n)).toEqual([0, 0]);
    expect(g.columns.every(c => c.medianS == null)).toBe(true);
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
    const spread = g.columns[0].spreadS!;
    const l5 = g.rows.find(r => r.lapId === 'L5')!;
    expect(l5.cells[0].unit).toBe(1);
    const l2 = g.rows.find(r => r.lapId === 'L2')!;
    expect(l2.cells[0].unit).toBeCloseTo((10.2 - 10.2) / spread, 6);
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

describe('bars and the shared scale', () => {
  test('bar fractions are against the widest column spread', () => {
    const g = sessionGrid(times(), ticked('L1', 'L2', 'L4'));
    const widest = Math.max(...g.columns.map(c => c.spreadS ?? 0));
    expect(Math.max(...g.columns.map(c => c.barFraction))).toBeCloseTo(1, 6);
    g.columns.forEach(c =>
      expect(c.barFraction).toBeCloseTo((c.spreadS ?? 0) / widest, 6),
    );
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
        stint: 1,
        ticked: true,
        cells: [{timeS: 5, deltaS: null, unit: 0, best: false}],
      },
      {
        lapId: 'B',
        stint: 1,
        ticked: true,
        cells: [{timeS: 5, deltaS: null, unit: 0, best: false}],
      },
    ];
    const out = sortRows(rows, {kind: 'column', index: 0, dir: 'desc'});
    expect(out.map(r => r.lapId)).toEqual(['A', 'B']);
  });
});
