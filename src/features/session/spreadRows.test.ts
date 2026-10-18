import {describe, expect, it} from '@jest/globals';

import {type SegmentTimes} from '@/src/analysis/segments';

import {spreadRows} from './spreadRows';

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
  it('biggest first, with a percent, a bar against the biggest and where a tap goes', () => {
    const rows = spreadRows(times(), all, table);
    expect(rows.map(r => r.head)).toEqual(['T1', 'T2', 'S/F']);
    expect(rows[0]).toMatchObject({
      pct: '94 %',
      frac: 1,
      corner: 3,
      whole: true,
    });
    expect(rows[1].frac).toBeCloseTo(1 / 16, 6);
    expect(rows[2].corner).toBeNull();
  });

  it('reads only the basis laps, and nothing under ten of them', () => {
    expect(spreadRows(times(), new Set(['L0', 'L1', 'L2']), table)).toEqual([]);
  });

  it('is empty with no times', () => {
    expect(spreadRows(null, all, null)).toEqual([]);
  });
});
