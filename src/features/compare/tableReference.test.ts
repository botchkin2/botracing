import {describe, expect, it} from '@jest/globals';

import {
  toLaps,
  toSessionDetail,
  toTrackMap,
} from '@/src/data/sessions/adapters';

import {buildCompareModel, type CompareSelection} from './model';
import {tableReference} from './tableReference';

const LENGTH_M = 1000;

const boundaries = {
  v: 1,
  rev: 1,
  startsM: [100, 500],
  marginM: [20, 20],
  windows: [
    {kind: 'start-straight', section: null, fromM: 0, toM: 100, parts: []},
    {kind: 'section', section: 1, fromM: 100, toM: 500, parts: []},
    {kind: 'section', section: 2, fromM: 500, toM: 1000, parts: []},
  ],
};

const map = (b: unknown = boundaries) =>
  toTrackMap({
    lengthM: LENGTH_M,
    boundaries: b,
    corners: [
      {n: 1, entryM: 150, apexM: 200, exitM: 300, parts: []},
      {n: 2, entryM: 550, apexM: 600, exitM: 700, parts: []},
    ],
    outline: {features: []},
  });

const session = toSessionDetail({
  id: 's1',
  sim: 'lmu',
  track: {name: 'Test Ring', variant: 'Test Ring'},
  car: {name: 'Manthey DK Engineering 2026 #91:LM'},
  sessionType: 'Race',
  startedAt: '2026-09-26T00:00:00Z',
  bestLapId: 'a',
  medianLapTime: 30,
  stints: [],
});

const win = (segTime: number, from: number, to: number) => ({
  segTime,
  fromM: from,
  toM: to,
  runInS: segTime / 4,
  cornerS: segTime / 2,
  exitS: segTime / 4,
  pit: false,
  parts: [],
  brakeApps: [],
});

// A lap's start straight, S1 and S2 times; its lap time is their sum.
const rawLap = (
  id: string,
  stint: number,
  start: number,
  s1: number,
  s2: number,
  stamp: unknown = {v: 1, rev: 1},
) => ({
  id,
  stint,
  lapTime: start + s1 + s2,
  comparable: true,
  reasons: [],
  cornerBoundaries: stamp,
  startStraight: {segTime: start, fromM: 0, toM: 100, pit: false},
  corners: [win(s1, 100, 500), win(s2, 500, 1000)],
});

// Stint 1: s1 8..12 (median 10), s2 12 x4 and 16 (median 12), start 4.
const stintLaps = [
  rawLap('a', 1, 4, 8, 12),
  rawLap('b', 1, 4, 9, 12),
  rawLap('c', 1, 4, 10, 12),
  rawLap('d', 1, 4, 11, 12),
  rawLap('e', 1, 4, 12, 16),
];
const laps = toLaps(stintLaps);
const byId = new Map(laps.map(l => [l.id, l]));
const pick = (...ids: string[]) => ids.map(id => byId.get(id)!);

describe('tableReference', () => {
  it("reads the checked laps' medians from 3 checked laps", () => {
    const r = tableReference({
      selected: pick('a', 'b', 'c'),
      sessionLaps: laps,
      map: map(),
      refName: 'L1',
    });
    expect(r.kind).toBe('set');
    expect(r.label).toBe('median of 3 checked laps');
    // S1 of a, b, c is 8, 9, 10; S2 is 12 each; the start straight 4.
    expect(r.sectionS.get(1)).toBe(9);
    expect(r.sectionS.get(2)).toBe(12);
    expect(r.totalS).toBe(4 + 9 + 12);
  });

  it('reads the midpoint of 2 checked laps', () => {
    const r = tableReference({
      selected: pick('a', 'b'),
      sessionLaps: laps,
      map: map(),
      refName: 'L1',
    });
    expect(r.kind).toBe('set');
    expect(r.label).toBe('median of 2 checked laps');
    expect(r.sectionS.get(1)).toBe(8.5);
    expect(r.sectionS.get(2)).toBe(12);
  });

  it("falls back to the lap's stint medians under 2 checked laps", () => {
    const r = tableReference({
      selected: pick('a'),
      sessionLaps: laps,
      map: map(),
      refName: 'L1',
    });
    expect(r.kind).toBe('stint');
    expect(r.label).toBe('stint 1 medians, n = 5');
    expect(r.sectionS.get(1)).toBe(10);
    expect(r.sectionS.get(2)).toBe(12);
    expect(r.totalS).toBe(4 + 10 + 12);
  });

  it('falls back to the reference lap without windows, or with laps cut at other boundaries', () => {
    expect(
      tableReference({
        selected: pick('a', 'b', 'c'),
        sessionLaps: laps,
        map: map(null),
        refName: 'L1',
      }),
    ).toMatchObject({kind: 'lap', label: 'L1', totalS: null});
    const old = toLaps(
      stintLaps.map(l => ({...l, cornerBoundaries: {v: 1, rev: 0}})),
    );
    expect(
      tableReference({
        selected: old.slice(0, 3),
        sessionLaps: old,
        map: map(),
        refName: 'L1',
      }).kind,
    ).toBe('lap');
  });

  it('leaves a pit window out of its own median only', () => {
    const withPit = toLaps([
      ...stintLaps.slice(0, 2),
      {
        ...stintLaps[2],
        corners: [{...win(10, 100, 500), pit: true}, win(12, 500, 1000)],
      },
    ]);
    const r = tableReference({
      selected: withPit,
      sessionLaps: withPit,
      map: map(),
      refName: 'L1',
    });
    // S1 has 2 times (the pit lap's is left out): their midpoint; S2 has 3.
    expect(r.sectionS.get(1)).toBe(8.5);
    expect(r.sectionS.get(2)).toBe(12);
  });
});

describe('Compare tables against the checked set', () => {
  const sel = (ids: string[]): CompareSelection => ({
    laps: ids,
    ref: null,
    hl: null,
    corner: null,
    cursorM: 600,
  });
  const build = (ids: string[], m = map()) =>
    buildCompareModel({
      session,
      laps,
      traces: new Map(),
      band: null,
      map: m,
      selection: sel(ids),
    });

  it("prints every lap's chip delta against the median lap time", () => {
    const m = build(['a', 'b', 'c']);
    expect(m.tableReference).toEqual({
      chips: 'median of 3',
      grid: 'median of 3 checked laps',
    });
    // The median lap is 25 s: a is 24 (-1.000), b 25 (+0.000), c 26 (+1.000).
    expect(m.chips.map(c => [c.label, c.delta, c.isRef])).toEqual([
      ['L1', '−1.000', false],
      ['L2', '±0.000', false],
      ['L3', '+1.000', false],
    ]);
  });

  it('shows the time per section against the set, the reference as a row too', () => {
    const g = build(['a', 'b', 'c']).grid!;
    expect(g.rows.map(r => r.label)).toEqual(['L1', 'L2', 'L3']);
    // S1 median 9, S2 median 12: a is 8 and 12, c is 10 and 12.
    expect(g.rows[0].cells).toEqual([-1, 0]);
    expect(g.rows[2].cells).toEqual([1, 0]);
  });

  it('two checked laps are a set: their midpoint, not the first lap', () => {
    const m = build(['a', 'b']);
    expect(m.tableReference.grid).toBe('median of 2 checked laps');
    expect(m.tableReference.chips).toBe('median of 2');
    // The median of 24 s and 25 s is 24.5 s.
    expect(m.chips[0].delta).toBe('−0.500');
    // S1 8 and 9 give 8.5: a is -0.5, b is +0.5, whichever is checked first.
    expect(m.grid!.rows.map(r => r.cells[0])).toEqual([-0.5, 0.5]);
    expect(build(['b', 'a']).grid!.rows.map(r => r.cells[0])).toEqual([-0.5, 0.5]);
  });

  it('gives a lap cut at other boundaries no cells, and says so', () => {
    const stale = toLaps([
      ...stintLaps.slice(0, 3),
      rawLap('x', 1, 4, 30, 30, {v: 1, rev: 0}),
    ]);
    const m = buildCompareModel({
      session,
      laps: stale,
      traces: new Map(),
      band: null,
      map: map(),
      selection: sel(['a', 'b', 'c', 'x']),
    });
    expect(m.tableReference.grid).toBe('median of 3 checked laps');
    const row = m.grid!.rows.find(r => r.lapId === 'x')!;
    expect(row.cells).toEqual([null, null]);
    expect(m.grid!.rows.find(r => r.lapId === 'a')!.cells).toEqual([-1, 0]);
    // The chip delta is a lap time, which does not depend on the cut.
    expect(m.chips.find(c => c.lapId === 'x')!.delta).toBe('+38.500');
  });

  it('measures against one lap alone when it is the Ref lap', () => {
    const m = buildCompareModel({
      session,
      laps,
      traces: new Map(),
      band: null,
      map: map(),
      selection: {...sel(['a', 'b', 'c']), ref: 'b'},
    });
    expect(m.tableReference).toEqual({chips: 'L2', grid: 'L2'});
    expect(m.chips.map(c => [c.label, c.delta, c.isRef])).toEqual([
      ['L1', '−1.000', false],
      ['L2', 'REF', true],
      ['L3', '+1.000', false],
    ]);
    // Section deltas are against L2's own sections.
    expect(m.grid!.rows.map(r => r.label)).toEqual(['L1', 'L3']);
  });

  it('keeps the median basis without windows, the tables on a lap', () => {
    const m = build(['a', 'b', 'c'], map(null));
    expect(m.tableReference.chips).toBe('median of 3');
    expect(m.tableReference.grid).toBe('L1');
    expect(m.chips.map(c => c.delta)).toEqual(['−1.000', '±0.000', '+1.000']);
  });
});
