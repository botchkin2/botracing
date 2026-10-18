import {describe, expect, it} from '@jest/globals';

import {toLaps, toTrackMap} from '@/src/data/sessions/adapters';

import {brakeLedger} from './brakeLedger';

// Two sections (corners 1-2 and 3) cut at boundaries, as spreadLanding.test.ts.
const boundaries = {
  v: 1,
  rev: 3,
  startsM: [150, 600],
  marginM: [20, 20],
  windows: [
    {kind: 'start-straight', section: null, fromM: 0, toM: 150, parts: []},
    {kind: 'section', section: 1, fromM: 150, toM: 600, parts: []},
    {kind: 'section', section: 3, fromM: 600, toM: 1000, parts: []},
  ],
};
const corner = (n: number, entryM: number) => ({
  n,
  entryM,
  apexM: entryM + 20,
  exitM: entryM + 40,
  parts: [],
});
const map = () =>
  toTrackMap({
    lengthM: 1000,
    boundaries,
    corners: [
      {...corner(1, 200), parts: [corner(1, 200), corner(2, 300)]},
      corner(3, 700),
    ],
    outline: {features: []},
  });

const seg = (
  time: number,
  fromM: number,
  toM: number,
  brakeAtM: number | null,
) => ({
  segTime: time,
  offTrackSec: 0,
  localYellowSec: 0,
  parts: [],
  brakeApps: [],
  brakeAtM,
  fromM,
  toM,
  runInS: time / 4,
  cornerS: time / 2,
  exitS: time / 4,
  pit: false,
});
// Section 1 brakes within +-2 m, section 3 within +-20 m.
const lap = (i: number, over: {pit?: boolean} = {}) => ({
  id: `l${i}`,
  lapTime: 100,
  stint: 1,
  comparable: true,
  reasons: [],
  sectors: [],
  cornerBoundaries: {v: 1, rev: 3},
  startStraight: {...seg(5, 0, 150, null), pit: false},
  corners: [
    {
      // The section's own brake-on is wherever the lap first braked: part 1 on
      // even laps, part 2 on odd ones, 100 m apart (the mix chord ruled out).
      ...seg(40, 150, 600, i % 2 === 0 ? 300 + (i % 5) - 2 : 400 + (i % 5) - 2),
      parts: [
        seg(20, 150, 350, 300 + (i % 5) - 2),
        seg(20, 350, 600, 400 + (i % 5) - 2),
      ],
    },
    {
      ...seg(55, 600, 1000, 800 + 10 * ((i % 5) - 2)),
      pit: over.pit ?? false,
    },
  ],
  traffic: null,
});
const laps = (n = 12, over = {}) =>
  toLaps(Array.from({length: n}, (_, i) => lap(i, over)));
const all = (ls: ReturnType<typeof laps>) => new Set(ls.map(l => l.id));

describe('brakeLedger', () => {
  it('a zone is a corner part: the compound section splits into its two boards, none reading 100 m', () => {
    const ls = laps();
    const rows = brakeLedger(ls, all(ls), map());
    expect(rows.map(r => r.head)).toEqual(['T3', 'T1', 'T2']);
    expect(rows.every(r => parseInt(r.spread, 10) < 60)).toBe(true);
    // Each part opens its own corner, not the section whole; the single corner does.
    expect(rows.map(r => [r.corner, r.whole])).toEqual([
      [3, false],
      [1, false],
      [2, false],
    ]);
  });

  it('lists the loosest first, in metres, on one scale for every row', () => {
    const ls = laps();
    const rows = brakeLedger(ls, all(ls), map());
    const widest = Math.max(...rows[0].dots.map(d => Math.abs(d ?? 0)));
    expect(widest).toBe(1);
    // Ten times looser: the tight zones' widest dot sits a tenth of the way out.
    const tight = Math.max(...rows[1].dots.map(d => Math.abs(d ?? 0)));
    expect(tight).toBeCloseTo(0.1, 1);
  });

  it('leaves out a window that does not count, and a zone under ten laps', () => {
    const ls = laps(12, {pit: true});
    // Section 3 is a pit window on every lap: only the two parts are left.
    expect(brakeLedger(ls, all(ls), map()).map(r => r.head)).toEqual([
      'T1',
      'T2',
    ]);
    const few = laps(9);
    expect(brakeLedger(few, all(few), map())).toEqual([]);
  });

  it('reads only the basis laps, and nothing without the map windows', () => {
    const ls = laps();
    expect(brakeLedger(ls, new Set(['l0', 'l1']), map())).toEqual([]);
    expect(brakeLedger(ls, all(ls), null)).toEqual([]);
  });
});
