import {describe, expect, it} from '@jest/globals';

import {type RawTrace, resampleTrace} from '@/src/analysis/resample';
// Adapters are internal to data/; tests reach them to build real shapes.
import {
  toLaps,
  toSessionDetail,
  toTrackMap,
} from '@/src/data/sessions/adapters';

import {
  buildCompareModel,
  snapOut,
  cornerPlace,
  followPlace,
  type CompareSelection,
  makeReference,
  removeLap,
  toggleCompared,
  valuesAt,
} from './model';

const LENGTH_M = 1000;

// A lap on a 1000 m circle at constant speed, in LMU's fake-origin degrees.
function circleLap(speedKph: number): RawTrace {
  const v = speedKph / 3.6;
  const n = Math.ceil(LENGTH_M / v / 0.1) + 1;
  const pct = Array.from({length: n}, (_, i) =>
    Math.min(1, (i * 0.1 * v) / LENGTH_M),
  );
  const r = LENGTH_M / (2 * Math.PI);
  const same = (x: number) => pct.map(() => x);
  return {
    lapDistPct: pct,
    speedKph: same(speedKph),
    throttlePct: same(80),
    brakePct: same(0),
    steeringPct: same(5),
    gear: same(4),
    lat: pct.map(p => 60 + (r * Math.sin(2 * Math.PI * p)) / 110540),
    lon: pct.map(p => (r * Math.cos(2 * Math.PI * p)) / (111320 * 0.5)),
  };
}

const session = toSessionDetail({
  id: 's1',
  sim: 'lmu',
  track: {name: 'Test Ring', variant: 'Test Ring'},
  car: {name: 'Manthey DK Engineering 2026 #91:LM'},
  sessionType: 'Race',
  startedAt: '2026-09-26T00:00:00Z',
  bestLapId: 'a',
  medianLapTime: 20,
  stints: [],
});

const section = (segTime: number) => ({segTime, parts: []});
const rawLap = (id: string, lapTime: number, segs: number[]) => ({
  id,
  lapTime,
  comparable: true,
  reasons: [],
  corners: segs.map(section),
});
const laps = toLaps([
  rawLap('a', 20.0, [5, 5]),
  rawLap('b', 20.4, [5.3, 5.1]),
  rawLap('c', 19.9, [4.95, 4.95]),
]);

const map = toTrackMap({
  lengthM: LENGTH_M,
  corners: [
    {n: 1, entryM: 100, apexM: 200, exitM: 300, parts: []},
    {n: 2, entryM: 500, apexM: 600, exitM: 700, parts: []},
  ],
  quality: 'poor',
  outline: {features: []},
});

const traces = new Map([
  ['a', resampleTrace(circleLap(180), LENGTH_M, 5, 10)],
  ['b', resampleTrace(circleLap(176.4), LENGTH_M, 5, 10)],
  ['c', resampleTrace(circleLap(181), LENGTH_M, 5, 10)],
]);

const sel = (over: Partial<CompareSelection> = {}): CompareSelection => ({
  laps: ['a', 'b', 'c'],
  hl: null,
  corner: null,
  cursorM: 600,
  ...over,
});

const build = (s = sel()) =>
  buildCompareModel({session, laps, traces, band: null, map, selection: s});

describe('start/finish wrap', () => {
  const at = (lapIds: string[], cursorM: number) =>
    buildCompareModel({
      session,
      laps,
      traces,
      band: null,
      map,
      selection: sel({laps: lapIds, cursorM}),
      charts: [['speed'], ['timeDiff']],
      window: {mode: 'distance', size: 200},
    });

  it('draws the previous lap before the line and the next after the end', () => {
    // a, b, c are laps 1, 2, 3 of one stint.
    const m = at(['b', 'c'], 0);
    const speedB = m.charts[0].lines.find(l => l.lapId === 'b')!;
    expect(speedB.before!.distanceM.every(d => d <= 0 && d >= -500)).toBe(true);
    expect(speedB.before!.values[0]).toBeCloseTo(180);
    expect(speedB.after!.distanceM.every(d => d > 1000)).toBe(true);
    expect(speedB.after!.values[0]).toBeCloseTo(181);
    expect(m.apexMarks).toContainEqual({m: 0, label: 'S/F', solid: true});
  });

  it('keeps the time diff continuous at the seam', () => {
    const m = at(['b', 'c'], 0);
    const tdC = m.charts[1].lines.find(l => l.lapId === 'c')!;
    // Continuous: the last wrapped value meets the lap's value at 0 m.
    expect(tdC.before!.values.at(-1)).toBeCloseTo(tdC.values[0], 1);
  });

  it('leaves the first lap empty before the line, and says why', () => {
    const m = at(['a', 'b'], 0);
    const speedA = m.charts[0].lines.find(l => l.lapId === 'a')!;
    expect(speedA.before).toBeUndefined();
    expect(m.apexMarks).toContainEqual({
      m: 0,
      label: 'S/F · start',
      solid: true,
    });
  });
});

describe('buildCompareModel', () => {
  it('names the reference and signs each chip against it', () => {
    const m = build();
    expect(m.reference).toBe('L1 · 0:20.000 · Race best');
    expect(m.chips.map(c => [c.label, c.delta, c.faster])).toEqual([
      ['L1', 'REF', false],
      ['L2', '+0.400', false],
      ['L3', '−0.100', true],
    ]);
    expect(m.manyChip).toBeNull();
  });

  it('builds the default chart set with time diff on a zero line', () => {
    const m = build();
    expect(m.charts.map(c => c.title)).toEqual([
      'Time diff',
      'Speed',
      'Throttle + Brake',
      'Steering',
      'Gear',
    ]);
    const td = m.charts[0];
    expect(m.charts.map(c => c.zeroLine)).toEqual([
      'timeDiff',
      null,
      null,
      'steering',
      null,
    ]);
    // L2 is slower everywhere, so its gap to the reference grows.
    const l2 = td.lines.find(l => l.label === 'L2')!;
    expect(l2.values[0]).toBe(0);
    expect(l2.values[200]).toBeGreaterThan(0.39);
    expect(m.charts[2].explainer).toBe(
      'Throttle solid, Brake dashed. Same scale.',
    );
    expect(m.charts[2].height).toBe(64);
  });

  it('reads values at the cursor for every shown lap', () => {
    const speed = build().charts[1].valueRows[0];
    expect(speed.values.map(v => v.text)).toEqual(['180', '176', '181']);
  });

  it('grid shows each lap vs the reference per corner', () => {
    const g = build().grid!;
    expect(g.corners).toEqual([1, 2]);
    expect(g.rows.map(r => r.cells.map(c => Number(c!.toFixed(2))))).toEqual([
      [0.3, 0.1],
      [-0.05, -0.05],
    ]);
    expect(g.explainer).toMatch(/^Time in each section vs L1, in seconds\./);
  });

  it('plain map for a poor fit: lines and dots, no outline', () => {
    const mm = build().map!;
    expect(mm.realMap).toBe(false);
    expect(mm.outline).toEqual([]);
    expect(mm.lines).toHaveLength(3);
    expect(mm.dots).toHaveLength(3);
    expect(mm.sectionApexes.map(s => s.n)).toEqual([1, 2]);
    expect(mm.marks.sections.map(s => s.n)).toEqual([1, 2]);
    expect(mm.pitLane).toEqual([]);
    // Reference drawn last (on top), highlighted (L2 by default) just below.
    expect(mm.lines.map(l => l.label)).toEqual(['L3', 'L2', 'L1']);
    expect(mm.dots.map(d => d.label)).toEqual(['L3', 'L2', 'L1']);
  });

  it('position row names the corner under the cursor', () => {
    expect(build().position.place).toBe('Section 2');
    expect(build(sel({cursorM: 850})).position.place).toBe('After Section 2');
    expect(build().position.distance).toBe('600 m');
  });

  it('counts laps still waiting for their trace', () => {
    const m = buildCompareModel({
      session,
      laps,
      traces: new Map([['a', traces.get('a')!]]),
      band: null,
      map,
      selection: sel(),
    });
    expect(m.pending).toBe(2);
  });
});

it('counts ids the session does not have', () => {
  const m = build(sel({laps: ['a', 'L4', 'b']}));
  expect(m.notFound).toBe(1);
  expect(m.chips.map(c => c.label)).toEqual(['L1', 'L2']);
});

describe('chart window', () => {
  const m = buildCompareModel({
    session,
    laps,
    traces,
    band: null,
    map,
    selection: sel({cursorM: 600}),
    window: {mode: 'distance', size: 200},
  });

  it('shows 200 m around the cursor', () => {
    expect(m.windowM).toEqual([500, 700]);
  });

  it('time diff is the absolute gap, the same as the whole lap', () => {
    const td = m.charts[0];
    const l2 = td.lines.find(l => l.label === 'L2')!;
    const whole = build().charts[0].lines.find(l => l.label === 'L2')!;
    expect(l2.values).toEqual(whole.values);
    expect(Number(td.valueRows[0].values[1].text)).toBeGreaterThan(0.2);
    expect(td.explainer).toMatch(/^Running gap to the reference/);
  });

  it('pedals are fixed at -4..104; apex lines inside the window only', () => {
    expect(m.charts[2].domains.throttle).toEqual([-4, 104]);
    expect(m.apexMarks).toEqual([{m: 600, label: 'C2 apex'}]);
  });

  it('whole lap without a size: no rebase, no apex lines', () => {
    const lap = build();
    expect(lap.windowM).toEqual([0, 1000]);
    expect(lap.apexMarks).toEqual([]);
  });
});

describe('desktop pieces', () => {
  const m = build();

  it('all laps by stint, with selection order', () => {
    expect(m.allLaps).toHaveLength(1);
    expect(m.allLaps[0].rows.map(r => [r.label, r.selIndex, r.tag])).toEqual([
      ['L1', 0, 'BEST'],
      ['L2', 1, null],
      ['L3', 2, null],
    ]);
  });

  it('values table reads every channel for each key lap', () => {
    const rows = valuesAt(m.readouts, m.stepM, 600);
    expect(rows.map(r => r.label)).toEqual([
      'Time diff',
      'Speed',
      'Throttle',
      'Brake',
      'Steering',
      'Gear',
    ]);
    expect(rows[1].values.map(v => v.text)).toEqual(['180', '176', '181']);
    expect(rows[0].values[0].text).toBe('±0.000');
  });

  it('overview has the whole-lap time diff per lap; section entries', () => {
    expect(m.overview).toHaveLength(3);
    expect(m.overview[1].values.at(-1)).toBeCloseTo(0.4);
    expect(m.sectionEntryM).toEqual({1: 100, 2: 500});
  });

  it('toggling a lap adds or removes it, never the reference', () => {
    expect(toggleCompared(sel({laps: ['a']}), 'b').laps).toEqual(['a', 'b']);
    expect(toggleCompared(sel(), 'b').laps).toEqual(['a', 'c']);
    expect(toggleCompared(sel(), 'a').laps).toEqual(['a', 'b', 'c']);
  });
});

describe('many laps', () => {
  const many = toLaps(
    Array.from({length: 8}, (_, i) =>
      rawLap(`m${i}`, 20 + i / 10, [5 + i / 10, 5]),
    ),
  );
  const manyTraces = new Map(
    many.map(l => [
      l.id,
      resampleTrace(circleLap(180 - l.lapIndex), LENGTH_M, 5, 10),
    ]),
  );
  const m = buildCompareModel({
    session,
    laps: many,
    traces: manyTraces,
    band: null,
    map,
    selection: sel({laps: many.map(l => l.id), hl: 'm3'}),
  });

  it('tinted mode above 6 laps: only ref and highlighted are key', () => {
    expect(m.mode).toBe('tinted');
    expect(m.chips.map(c => c.label)).toEqual(['L1', 'L4']);
    expect(m.manyChip).toBe('+7 laps, tinted');
    expect(m.charts[1].valueRows[0].values).toHaveLength(2);
  });

  it('grid shows the median row plus the highlighted lap', () => {
    expect(m.grid!.rows.map(r => r.label)).toEqual(['MED', 'L4']);
    expect(m.grid!.rows[0].cells[0]).toBeCloseTo(0.4);
  });
});

describe('selection edits', () => {
  it('making a lap the reference moves it first', () => {
    expect(makeReference(sel(), 'c').laps).toEqual(['c', 'a', 'b']);
  });
  it('the reference cannot be removed', () => {
    expect(removeLap(sel(), 'a')).toEqual(sel());
    expect(removeLap(sel(), 'b').laps).toEqual(['a', 'c']);
  });
});

describe('cornerPlace', () => {
  const s = [
    {n: 1, entryM: 100, exitM: 300},
    {n: 2, entryM: 500, exitM: 700},
  ];
  it('inside, approaching and after', () => {
    expect(cornerPlace(s, 200)).toBe('Section 1');
    expect(cornerPlace(s, 400)).toBe('Section 2');
    expect(cornerPlace(s, 310)).toBe('After Section 1');
    expect(cornerPlace(s, 50)).toBe('Section 1');
    expect(cornerPlace(s, 900)).toBe('After Section 2');
  });
});

describe('zero line in an overlay', () => {
  it('belongs to steering, whose range always holds 0', () => {
    const [c] = buildCompareModel({
      session,
      laps,
      traces,
      band: null,
      map,
      selection: sel({cursorM: 300}),
      charts: [['speed', 'steering']],
      window: {mode: 'time', size: 2},
    }).charts;
    expect(c.zeroLine).toBe('steering');
    const [lo, hi] = c.domains.steering!;
    expect(lo).toBeLessThan(0);
    expect(hi).toBeGreaterThan(0);
  });
});

describe('recorded samples', () => {
  const m = buildCompareModel({
    session,
    laps,
    traces,
    band: null,
    map,
    selection: sel({cursorM: 333}),
    charts: [['speed'], ['timeDiff']],
    window: {mode: 'time', size: 2},
  });
  it('speed lines carry their recorded samples; the time diff does not', () => {
    expect(m.charts[0].lines[0].samples).toBe(
      traces.get('a')!.samples.speedKph,
    );
    expect(m.charts[1].lines[0].samples).toBeUndefined();
  });
  it('the cursor readout is a recorded sample, not a blend', () => {
    const recorded = new Set(
      traces.get('a')!.samples.speedKph.values.map(v => v.toFixed(0)),
    );
    const text = m.charts[0].valueRows[0].values[0].text;
    expect(recorded.has(text)).toBe(true);
  });
});

describe('followPlace', () => {
  const c = (n: number, entryM: number, exitM: number) => ({
    n,
    entryM,
    apexM: (entryM + exitM) / 2,
    exitM,
  });
  const s = [
    {...c(1, 100, 300), parts: [c(1, 100, 180), c(2, 200, 300)]},
    {...c(2, 500, 700), parts: []},
  ];
  it('adds the corner inside its range, using parts when there are any', () => {
    expect(followPlace(s, 150)).toBe('Section 1 · C1 apex');
    expect(followPlace(s, 250)).toBe('Section 1 · C2 apex');
    expect(followPlace(s, 600)).toBe('Section 2 · C2 apex');
  });
  it('is the section alone between corners', () => {
    expect(followPlace(s, 190)).toBe('Section 1');
    expect(followPlace(s, 400)).toBe('Section 2');
  });
});

describe('y ranges in a window', () => {
  const at = (cursorM: number) =>
    buildCompareModel({
      session,
      laps,
      traces,
      band: null,
      map,
      selection: sel({cursorM}),
      charts: [['timeDiff'], ['speed']],
      window: {mode: 'time', size: 2},
    }).charts;
  it('speed fits the window, snapped outward to 20 km/h', () => {
    const [lo, hi] = at(600)[1].domains.speed!;
    expect(lo % 20).toBe(0);
    expect(hi % 20).toBe(0);
    expect(hi).toBeGreaterThan(lo);
  });
  it('the time diff fits the absolute gap, snapped to 0.05 s', () => {
    const [lo, hi] = at(600)[0].domains.timeDiff!;
    const steps = (v: number) => Math.abs(v / 0.05 - Math.round(v / 0.05));
    expect(steps(lo)).toBeLessThan(1e-9);
    expect(steps(hi)).toBeLessThan(1e-9);
    expect(hi - lo).toBeGreaterThanOrEqual(0.1 - 1e-9);
  });
  it('y ranges hold still while the window stays in the same sections', () => {
    // Sections enter at 100 and 500 m. A 2 s window at these cursors
    // touches only the 100–500 piece.
    const a = at(280);
    const b = at(320);
    expect(b[0].domains).toEqual(a[0].domains);
    expect(b[1].domains).toEqual(a[1].domains);
  });
});

describe('snapOut', () => {
  it('widens to the step: a hairpin and a straight', () => {
    expect(snapOut(63, 137, 20)).toEqual([60, 140]);
    expect(snapOut(181, 259, 20)).toEqual([180, 260]);
    expect(snapOut(-23, 23, 10)).toEqual([-30, 30]);
    expect(snapOut(100, 100, 20)).toEqual([100, 120]);
  });
});
