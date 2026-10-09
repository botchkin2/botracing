import {describe, expect, it} from '@jest/globals';

import {type RawTrace, resampleTrace} from '@/src/analysis/resample';
import {type Lap, referenceDefaultLapIds} from '@/src/data/sessions';
import {lapColors, lapStroke} from '@/src/design';
// Adapters are internal to data/; tests reach them to build real shapes.
import {
  toLaps,
  toSessionDetail,
  toTrackMap,
} from '@/src/data/sessions/adapters';

import {
  BASIS_ID,
  buildCompareModel,
  medianBasisOf,
  snapOut,
  cornerPlace,
  pedalsDomains,
  followPlace,
  type CompareSelection,
  clearRef,
  canRemoveLap,
  removeLap,
  sectionStartM,
  setRef,
  toggleHighlight,
  toggleCompared,
  valuesAt,
  withDefaultLaps,
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
  // The game's lap count: a is 1, b is 2, c is 3 (the radar needs it).
  lapNumber: id.charCodeAt(0) - 96,
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
  ref: null,
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
      // The wrap is drawn against the Ref lap's neighbours; the median has none.
      selection: sel({laps: lapIds, ref: lapIds[0], cursorM}),
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

  it('builds the wrap once per trace, not once per frame', () => {
    const one = at(['b', 'c'], 0).charts;
    const two = at(['b', 'c'], 5).charts;
    const b1 = one[0].lines.find(l => l.lapId === 'b')!;
    const b2 = two[0].lines.find(l => l.lapId === 'b')!;
    expect(b2.before).toBe(b1.before);
    expect(b2.after).toBe(b1.after);
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
  it('names the median basis and signs each chip against its time', () => {
    const m = build();
    expect(m.reference).toBe('median of 3 · 0:20.000');
    expect(m.chips.map(c => [c.label, c.isRef])).toEqual([
      ['L1', false],
      ['L2', false],
      ['L3', false],
    ]);
  });

  it('names the Ref lap and signs each chip against it', () => {
    const m = build(sel({ref: 'a'}));
    expect(m.reference).toBe('L1 · 0:20.000 · Race best');
    expect(m.chips.map(c => [c.label, c.delta, c.faster])).toEqual([
      ['L1', 'REF', false],
      ['L2', '+0.400', false],
      ['L3', '−0.100', true],
    ]);
  });

  it('builds the default chart set with time diff on a zero line', () => {
    const m = build();
    expect(m.charts.map(c => c.title)).toEqual([
      'Time diff vs median of 3',
      'Speed',
      'Throttle + Brake + Steering',
      'Gear',
    ]);
    const td = m.charts[0];
    expect(m.charts.map(c => c.zeroLine)).toEqual([
      'timeDiff',
      null,
      'steering',
      null,
    ]);
    // L2 is slower everywhere, so its gap to the reference grows.
    const l2 = td.lines.find(l => l.label === 'L2')!;
    expect(l2.values[0]).toBe(0);
    expect(l2.values[200]).toBeGreaterThan(0.39);
    expect(m.charts[2].pedals).toBe(true);
    expect(m.charts[2].height).toBe(140);
  });

  it('reads values at the cursor for every shown lap', () => {
    const speed = build().charts[1].valueRows[0];
    expect(speed.values.map(v => v.text)).toEqual(['180', '180', '176', '181']);
  });

  it('grid shows each lap vs the reference per corner', () => {
    const g = build().grid!;
    expect(g.corners).toEqual([1, 2]);
    expect(g.rows.map(r => r.cells.map(c => Number(c!.toFixed(2))))).toEqual([
      [0.3, 0.1],
      [-0.05, -0.05],
    ]);
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
    // No Ref lap and nothing highlighted: lap-number order, none on top.
    expect(mm.lines.map(l => l.label)).toEqual(['L1', 'L2', 'L3']);
    // Dots are for key laps only: the Ref lap, the highlighted one, or all
    // laps when there are few; here all three.
    expect(mm.dots.map(d => d.label)).toEqual(['L1', 'L2', 'L3']);
  });

  it('the map still draws the cursor when many laps are checked and none is key', () => {
    // Eight laps is past the individual mode, with no Ref lap and none
    // highlighted: no lap is a key lap, and the dot was missing (#273).
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const many = toLaps(
      ids.map((id, i) => rawLap(id, 20 + i * 0.1, [5 + i * 0.01, 5])),
    );
    const manyTraces = new Map(
      ids.map((id, i) => [
        id,
        resampleTrace(circleLap(180 - i), LENGTH_M, 5, 10),
      ]),
    );
    const at = (s: Partial<CompareSelection>) =>
      buildCompareModel({
        session,
        laps: many,
        traces: manyTraces,
        band: null,
        map,
        selection: sel({laps: ids, ...s}),
      }).map!;
    const median = at({});
    expect(median.dots).toHaveLength(1);
    expect(median.dots[0].lapId).toBe(BASIS_ID);
    expect(median.follow).toBeNull(); // geometry is the hook's; the dot does not wait for it
    // A Ref lap or a highlighted lap is its own dot, as before.
    expect(at({ref: 'c'}).dots.map(d => d.lapId)).toEqual(['c']);
    expect(at({hl: 'e'}).dots.map(d => d.lapId)).toEqual(['e']);
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
    expect(parseFloat(td.valueRows[0].values[2].text)).toBeGreaterThan(0.2);
    // The readout says seconds, and the label names the reference lap.
    expect(td.valueRows[0].values[2].text).toMatch(/ s$/);
    expect(td.valueRows[0].label).toBe('Time diff vs median of 3');
    expect(td.valueRows[0].unit).toBe('');
  });

  it('pedals chart shares one plot; apex lines inside the window only', () => {
    const [lo, hi] = m.charts[2].domains.throttle!;
    expect(hi).toBe(104);
    expect(m.charts[2].domains.brake).toEqual([lo, hi]);
    // A lone pedal chart keeps the fixed -4..104 range.
    const lone = buildCompareModel({
      session,
      laps,
      traces,
      band: null,
      map,
      selection: sel(),
      charts: [['throttle', 'brake']],
    });
    expect(lone.charts[0].domains.throttle).toEqual([-4, 104]);
    expect(m.apexMarks).toEqual([{m: 600, label: 'T2 apex'}]);
  });

  it('whole lap without a size: no rebase, no apex lines', () => {
    const lap = build();
    expect(lap.windowM).toEqual([0, 1000]);
    expect(lap.apexMarks).toEqual([]);
  });
});

describe('one color per lap, everywhere', () => {
  // The checkbox list, the chips (legend) and the trace values must agree on
  // each lap's slot. Median mode starts the slots at 1 (slot 0 is the Ref
  // stroke); the checkbox list once started at 0 and drew every lap one slot off.
  const slotsOf = (m: ReturnType<typeof build>) => {
    const fromChips = new Map(m.chips.map(c => [c.lapId, c.selIndex]));
    const fromRows = m.allLaps.flatMap(g =>
      g.rows
        .filter(r => r.selIndex != null)
        .map(r => [r.lapId, r.selIndex!] as [string, number]),
    );
    const fromTraces = m.charts.flatMap(c =>
      c.valueRows.flatMap(v =>
        v.values
          .filter(x => x.lapId != null)
          .map(x => [x.lapId!, x.selIndex] as [string, number]),
      ),
    );
    return {fromChips, fromRows, fromTraces};
  };

  it('median: checkbox, legend and trace slots match', () => {
    const m = build(sel({laps: ['a', 'b', 'c'], ref: null, hl: null}));
    const {fromChips, fromRows, fromTraces} = slotsOf(m);
    // Guard: the trace half below must not pass by checking nothing.
    expect(fromTraces.length).toBeGreaterThan(0);
    expect(fromRows.length).toBeGreaterThan(0);
    for (const [id, slot] of fromRows) {
      expect(slot).toBeGreaterThanOrEqual(1);
      expect(fromChips.get(id)).toBe(slot);
    }
    // The median basis row is not a lap: it has no chip and no slot.
    for (const [id, slot] of fromTraces)
      if (fromChips.has(id)) expect(fromChips.get(id)).toBe(slot);
  });

  it('ref: checkbox, legend and trace slots match, Ref on slot 0', () => {
    const m = build(sel({laps: ['a', 'b', 'c'], ref: 'b', hl: null}));
    const {fromChips, fromRows, fromTraces} = slotsOf(m);
    // Guard: the trace half below must not pass by checking nothing.
    expect(fromTraces.length).toBeGreaterThan(0);
    expect(fromRows.find(([id]) => id === 'b')?.[1]).toBe(0);
    for (const [id, slot] of fromRows) expect(fromChips.get(id)).toBe(slot);
    // The median basis row is not a lap: it has no chip and no slot.
    for (const [id, slot] of fromTraces)
      if (fromChips.has(id)) expect(fromChips.get(id)).toBe(slot);
  });
});

describe('desktop pieces', () => {
  const m = build();

  it('all laps by stint, with selection order', () => {
    expect(m.allLaps).toHaveLength(1);
    expect(m.allLaps[0].rows.map(r => [r.label, r.selIndex, r.tag])).toEqual([
      ['L1', 1, 'BEST'],
      ['L2', 2, null],
      ['L3', 3, null],
    ]);
  });

  it('a parked grid start is tagged PARK, a plain partial lap PART', () => {
    const parked = toLaps([rawLap('p', 5, [5]), rawLap('q', 5, [5])]);
    parked[0].partial = true;
    parked[0].partialWhy = 'grid';
    parked[1].partial = true;
    const tags = buildCompareModel({
      session,
      laps: parked,
      traces,
      band: null,
      map,
      selection: sel({laps: ['a']}),
    }).allLaps.flatMap(g => g.rows.map(r => r.tag));
    expect(tags).toEqual(['PARK', 'PART']);
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
    expect(rows[1].values.map(v => v.text)).toEqual([
      '180',
      '180',
      '176',
      '181',
    ]);
    expect(rows[0].values[0].text).toBe('±0.000 s');
  });

  it('overview has the whole-lap time diff per lap; section entries', () => {
    expect(m.overview).toHaveLength(3);
    expect(m.overview[1].values.at(-1)).toBeCloseTo(0.4);
    expect(m.sectionEntryM).toEqual({1: 100, 2: 500});
  });

  it('toggling a lap adds or removes it, never the Ref lap', () => {
    expect(toggleCompared(sel({laps: ['a']}), 'b').laps).toEqual(['a', 'b']);
    expect(toggleCompared(sel(), 'b').laps).toEqual(['a', 'c']);
    expect(toggleCompared(sel(), 'a').laps).toEqual(['b', 'c']);
    expect(toggleCompared(sel({ref: 'a'}), 'a').laps).toEqual(['a', 'b', 'c']);
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
    selection: sel({laps: many.map(l => l.id), ref: 'm0', hl: 'm3'}),
  });

  it('tinted mode above 6 laps: only ref and highlighted are key', () => {
    expect(m.mode).toBe('tinted');
    // Every checked lap has a chip; the readout holds the key laps.
    expect(m.chips).toHaveLength(8);
    expect(m.charts[1].valueRows[0].values).toHaveLength(2);
  });

  it('median mode, 11 laps, nothing highlighted: chips for all, readout leads with the basis', () => {
    const eleven = toLaps(
      Array.from({length: 11}, (_, i) =>
        rawLap(`e${i}`, 20 + i / 10, [5 + i / 10, 5]),
      ),
    );
    const elevenTraces = new Map(
      eleven.map(l => [
        l.id,
        resampleTrace(circleLap(180 - l.lapIndex), LENGTH_M, 5, 10),
      ]),
    );
    const out = buildCompareModel({
      session,
      laps: eleven,
      traces: elevenTraces,
      band: null,
      map,
      selection: sel({laps: eleven.map(l => l.id)}),
    });
    expect(out.chips).toHaveLength(11);
    expect(out.readouts.map(r => r.lapId)).toEqual([BASIS_ID]);
    const speed = out.charts[1].valueRows[0];
    expect(speed.values).toHaveLength(1);
    expect(speed.values[0].lapId).toBe(BASIS_ID);
    expect(out.charts[0].valueRows[0].values[0].text).toBe('±0.000 s');
  });

  it('colour slots: the Ref lap is slot 0, the others follow in lap order', () => {
    const out = build(sel({ref: 'b'}));
    expect(out.chips.map(c => [c.label, c.selIndex])).toEqual([
      ['L1', 1],
      ['L2', 0],
      ['L3', 2],
    ]);
    // Median mode: no lap is the reference, so none takes slot 0.
    expect(build().chips.map(c => c.selIndex)).toEqual([1, 2, 3]);
  });

  it('median mode never draws a lap as the reference, at 2, 6 and 11 laps', () => {
    for (const n of [2, 6, 11]) {
      const set = toLaps(
        Array.from({length: n}, (_, i) =>
          rawLap(`p${i}`, 20 + i / 10, [5 + i / 10, 5]),
        ),
      );
      const out = buildCompareModel({
        session,
        laps: set,
        traces: new Map(
          set.map(l => [
            l.id,
            resampleTrace(circleLap(180 - l.lapIndex), LENGTH_M, 5, 10),
          ]),
        ),
        band: null,
        map,
        selection: sel({laps: set.map(l => l.id)}),
      });
      const real = out.chips.filter(c => c.selIndex >= 0);
      expect(real).toHaveLength(n);
      expect(out.chips.some(c => c.isRef)).toBe(false);
      expect(real.every(c => c.selIndex >= 1)).toBe(true);
      // Individual mode (up to six laps) gives every slot its own colour;
      // above that the tints cycle.
      if (n <= 6)
        for (const scheme of ['dark', 'light'] as const)
          for (const c of real)
            expect(lapColors[scheme][c.selIndex]).toBeDefined();
      // And none is drawn with the reference stroke.
      for (const c of real)
        expect(lapStroke('dark', c.selIndex, n, false).color).not.toBe(
          lapColors.dark[0],
        );
    }
  });

  it('takes the median trace from the caller when given, and builds it when not', () => {
    const own = build(sel());
    const given = buildCompareModel({
      session,
      laps,
      traces,
      band: null,
      map,
      selection: sel(),
      basisTrace: medianBasisOf(laps, traces),
    });
    expect(given.refGrid!.timeS.at(-1)).toBe(own.refGrid!.timeS.at(-1));
  });

  it('the stint-set default (no Ref, no highlight, a map with boundaries) still has a grid: every checked lap', () => {
    // The tableReference fixture: laps with sections, a map with boundaries.
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
    const raw = (id: string, s1: number, s2: number) => ({
      id,
      stint: 1,
      lapTime: 4 + s1 + s2,
      comparable: true,
      reasons: [],
      cornerBoundaries: {v: 1, rev: 1},
      startStraight: {segTime: 4, fromM: 0, toM: 100, pit: false},
      corners: [win(s1, 100, 500), win(s2, 500, 1000)],
    });
    const sectionLaps = toLaps([
      raw('a', 8, 12),
      raw('b', 9, 12),
      raw('c', 10, 12),
      raw('d', 11, 12),
      raw('e', 12, 16),
      raw('f', 10, 13),
      raw('g', 9, 14),
    ]);
    const withBoundaries = toTrackMap({
      lengthM: LENGTH_M,
      boundaries: {
        v: 1,
        rev: 1,
        startsM: [100, 500],
        marginM: [20, 20],
        windows: [
          {
            kind: 'start-straight',
            section: null,
            fromM: 0,
            toM: 100,
            parts: [],
          },
          {kind: 'section', section: 1, fromM: 100, toM: 500, parts: []},
          {kind: 'section', section: 2, fromM: 500, toM: 1000, parts: []},
        ],
      },
      corners: [
        {n: 1, entryM: 150, apexM: 200, exitM: 300, parts: []},
        {n: 2, entryM: 550, apexM: 600, exitM: 700, parts: []},
      ],
      outline: {features: []},
    });
    const sectionTraces = new Map(
      sectionLaps.map(l => [
        l.id,
        resampleTrace(circleLap(180), LENGTH_M, 5, 10),
      ]),
    );
    const ids = sectionLaps.map(l => l.id);
    const m = buildCompareModel({
      session,
      laps: sectionLaps,
      traces: sectionTraces,
      band: null,
      map: withBoundaries,
      selection: {laps: ids, ref: null, hl: null, corner: null, cursorM: 600},
    });
    expect(m.tableReference.grid).toBe('median of 7 checked laps');
    expect(m.grid).not.toBeNull();
    expect(m.grid!.rows.map(r => r.lapId)).toEqual(ids);
    // A highlighted lap keeps every row too (#3309): the set stays visible.
    const hl = buildCompareModel({
      session,
      laps: sectionLaps,
      traces: sectionTraces,
      band: null,
      map: withBoundaries,
      selection: {laps: ids, ref: null, hl: 'c', corner: null, cursorM: 600},
    });
    expect(hl.grid!.rows.map(r => r.lapId)).toEqual(ids);
  });

  it('grid shows the median row plus the highlighted lap', () => {
    expect(m.grid!.rows.map(r => r.label)).toEqual(['MED', 'L4']);
    expect(m.grid!.rows[0].cells[0]).toBeCloseTo(0.4);
  });
});

describe('a URL with no laps', () => {
  const lap = (
    id: string,
    timeS: number | null,
    comparable = true,
    startL: number | null = null,
    stint = 1,
  ) =>
    ({
      id,
      timeS,
      comparable,
      stint,
      partial: false,
      pitIn: false,
      pitOut: false,
      endedInReset: false,
      hadImpact: false,
      offTrackS: 0,
      newTyres: false,
      fuel: startL == null ? null : {startL},
      traffic: null,
    } as unknown as Lap);
  const laps = [
    lap('a', 92.4),
    lap('b', 91.1),
    lap('c', 91.9),
    lap('d', 90.0, false),
  ];
  const facts = {id: 's1', bestLapId: 'b', car: 'GT3', sessionType: 'R'};

  it('opens on every comparable lap against their median, never a pair', () => {
    const out = withDefaultLaps(sel({laps: []}), laps, facts);
    expect(out.laps).toEqual(['a', 'b', 'c']);
    expect(out.ref).toBeNull();
    // The rest of the selection is untouched.
    expect(out.cursorM).toBe(600);
  });

  it('takes the stint with the most comparable laps, the later one on a tie', () => {
    // The 1 Oct race: a long first stint, a one-lap stint, a shorter last one.
    const race = [
      lap('s1a', 81.3, true, null, 1),
      lap('s1b', 81.2, true, null, 1),
      lap('s1c', 81.8, true, null, 1),
      lap('s2a', 82.0, true, null, 2),
      lap('s3a', 81.0, true, null, 3),
      lap('s3b', 80.9, true, null, 3),
    ];
    expect(withDefaultLaps(sel({laps: []}), race, facts).laps).toEqual([
      's1a',
      's1b',
      's1c',
    ]);
    const tie = race.filter(l => l.id !== 's1c');
    expect(withDefaultLaps(sel({laps: []}), tie, facts).laps).toEqual([
      's3a',
      's3b',
    ]);
  });

  it('a fair reference: the median lap and the fastest fair lap for it', () => {
    // c is the median of b, c, a; b is the fastest fair lap for it.
    expect(referenceDefaultLapIds(laps, facts)).toEqual(['b', 'c']);
  });

  it('a quicker lap on a lighter load is not the reference', () => {
    const race = [
      lap('light', 98.0, true, 20),
      lap('m1', 100.1, true, 62),
      lap('m2', 100.4, true, 60),
      lap('m3', 100.9, true, 58),
    ];
    // Median is m1 (100.1 s, 62 L): the fastest lap at that load is m1's
    // neighbour m2, not the 98.0 s lap with a third of the fuel.
    expect(
      referenceDefaultLapIds(race, {...facts, bestLapId: 'light'}),
    ).toEqual(['m2', 'm1']);
  });

  it('two comparable laps are still a set; the fair reference falls back to best and fastest other', () => {
    const few = [lap('a', 92.4), lap('b', 91.1), lap('x', 90, false)];
    expect(withDefaultLaps(sel({laps: []}), few, facts).laps).toEqual([
      'a',
      'b',
    ]);
    expect(referenceDefaultLapIds(few, {...facts, bestLapId: null})).toEqual([
      'b',
      'a',
    ]);
  });

  it('keeps the laps the URL names, and waits while the session or its laps load', () => {
    expect(withDefaultLaps(sel({laps: ['c', 'a']}), laps, facts).laps).toEqual([
      'c',
      'a',
    ]);
    const empty = sel({laps: []});
    expect(withDefaultLaps(empty, undefined, facts)).toBe(empty);
    expect(withDefaultLaps(empty, laps, undefined)).toBe(empty);
  });

  it('one comparable lap is the reference alone; none stays empty', () => {
    expect(
      withDefaultLaps(
        sel({laps: []}),
        [lap('a', 90), lap('x', 95, false)],
        facts,
      ).laps,
    ).toEqual(['a']);
    expect(
      withDefaultLaps(sel({laps: []}), [lap('x', 95, false)], facts).laps,
    ).toEqual([]);
  });
});

describe('selection edits', () => {
  it('setting the Ref lap reorders nothing', () => {
    expect(setRef(sel(), 'c')).toEqual(sel({ref: 'c'}));
    expect(setRef(sel({ref: 'c'}), 'a')).toEqual(sel({ref: 'a'}));
  });
  it('setting a lap that is not checked checks it', () => {
    // 'x' is in All laps but not in the comparison.
    expect(setRef(sel(), 'x')).toEqual(
      sel({laps: ['a', 'b', 'c', 'x'], ref: 'x'}),
    );
  });
  it('clearing the Ref lap goes back to the median', () => {
    expect(clearRef(sel({ref: 'b'}))).toEqual(sel());
    expect(clearRef(sel())).toEqual(sel());
  });
  it('highlighting toggles', () => {
    expect(toggleHighlight(sel(), 'b').hl).toBe('b');
    expect(toggleHighlight(sel({hl: 'b'}), 'b').hl).toBeNull();
  });
  it('the Ref lap cannot be removed, while another lap can', () => {
    expect(removeLap(sel({ref: 'a'}), 'a')).toEqual(sel({ref: 'a'}));
    expect(removeLap(sel({ref: 'a'}), 'b').laps).toEqual(['a', 'c']);
    expect(removeLap(sel(), 'a').laps).toEqual(['b', 'c']);
  });
  it('two checked laps stay', () => {
    expect(canRemoveLap(sel(), 'a')).toBe(true);
    expect(canRemoveLap(sel({ref: 'a'}), 'a')).toBe(false);
    expect(canRemoveLap(sel({laps: ['a', 'b']}), 'b')).toBe(false);
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
    expect(followPlace(s, 150)).toBe('Section 1 · T1 apex');
    expect(followPlace(s, 250)).toBe('Section 1 · T2 apex');
    expect(followPlace(s, 600)).toBe('Section 2 · T2 apex');
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

describe('pedals chart layout', () => {
  // y as a fraction of the plot height, 0 = top.
  const frac = (v: number, [lo, hi]: [number, number]) => (hi - v) / (hi - lo);
  const d = pedalsDomains(40);

  it('puts the pedals in the top 96/140 and steering in the bottom 36/140', () => {
    expect(frac(104, d.pedal)).toBeCloseTo(0);
    expect(frac(-4, d.pedal)).toBeCloseTo(96 / 140);
    expect(frac(40, d.steer)).toBeCloseTo(104 / 140);
    expect(frac(-40, d.steer)).toBeCloseTo(1);
    // Steering's zero is the middle of its band.
    expect(frac(0, d.steer)).toBeCloseTo(122 / 140);
  });
});

describe('trafficLane', () => {
  const traffic = (over: Record<string, unknown>) => ({
    draftS: 0,
    trafficAheadS: 3,
    trafficBehindS: 0,
    blueFlagS: 0,
    passesMade: 0,
    passesSuffered: 0,
    passesMadeAll: 0,
    passesSufferedAll: 0,
    battleS: 0,
    ...over,
  });
  const withTraffic = (id: string, over: Record<string, unknown>) => ({
    ...rawLap(id, 20, [5, 5]),
    traffic: traffic(over),
  });
  const field = {path: 'p', hash: 'h', hz: 5, cars: 3, durationS: 100};
  const fieldSession = toSessionDetail({
    id: 's1',
    sim: 'lmu',
    track: {name: 'Test Ring'},
    car: {name: 'Manthey DK Engineering 2026 #91:LM'},
    sessionType: 'Race',
    startedAt: '2026-09-26T00:00:00Z',
    stints: [],
    field,
  });
  const lanes = (ls: ReturnType<typeof toLaps>, ss = fieldSession) =>
    buildCompareModel({
      session: ss,
      laps: ls,
      traces,
      band: null,
      map,
      selection: sel({laps: ['a', 'b']}),
    }).trafficLane;

  it('says so for a session with no field', () => {
    expect(build().trafficLane).toEqual({kind: 'empty'});
  });

  it('is absent for a field whose laps carry no positions yet, never an empty lane', () => {
    const ls = toLaps([withTraffic('a', {}), withTraffic('b', {})]);
    expect(lanes(ls)).toBeNull();
  });

  it('has a row per selected lap with positions, scaled to the map', () => {
    const ls = toLaps([
      withTraffic('a', {
        fieldLapM: 2000,
        aheadSpans: [{fromM: 200, toM: 400, s: 3}],
        overtakes: [{cls: 'Hyper', atM: 1000}],
        passMarks: [{atM: 500, made: true}],
      }),
      withTraffic('b', {}),
    ]);
    const lane = lanes(ls);
    if (lane?.kind !== 'rows') throw new Error('no rows');
    expect(lane.rows.map(r => r.lapId)).toEqual(['a']);
    expect(lane.rows[0].ahead).toEqual([[100, 200]]);
    expect(lane.rows[0].ticks).toEqual([
      {m: 250, kind: 'pass'},
      {m: 500, kind: 'blue'},
    ]);
  });
});

describe('laps of another session', () => {
  // d is lap 1 of another session; its id in the selection is qualified.
  const other = toLaps([rawLap('d', 19.5, [4.9, 4.9])]);
  const fid = 's9~d';
  const foreign = {
    laps: [{...other[0], id: fid}],
    tags: new Map([[fid, '25 Sep']]),
  };
  const withTrace = new Map(traces);
  withTrace.set(fid, resampleTrace(circleLap(183), LENGTH_M, 5, 10));
  const m = buildCompareModel({
    session,
    laps,
    foreign,
    traces: withTrace,
    band: null,
    map,
    selection: sel({laps: [fid, 'a'], ref: fid, hl: 'a'}),
  });

  it('is the reference, named with its session so two L1s are not confused', () => {
    expect(m.reference).toContain('L1 · 25 Sep');
    expect(m.chips.map(c => c.label)).toContain('L1 · 25 Sep');
    expect(m.chips.find(c => c.lapId === fid)!.isRef).toBe(true);
    expect(m.charts[0].lines.some(l => l.lapId === fid)).toBe(true);
    expect(
      m.charts.flatMap(c => c.valueRows.map(r => r.label)).join(),
    ).toContain('vs L1 · 25 Sep');
  });

  it('names this session’s laps with its own tag beside a foreign one', () => {
    const tagged = buildCompareModel({
      session,
      laps,
      foreign: {...foreign, ownTag: '26 Sep Race'},
      traces: withTrace,
      band: null,
      map,
      selection: sel({laps: [fid, 'a'], ref: fid, hl: 'a'}),
    });
    expect(tagged.chips.map(c => c.label)).toEqual([
      'L1 · 26 Sep Race',
      'L1 · 25 Sep',
    ]);
    // Without a foreign lap in the view, nothing is tagged.
    expect(build().chips.every(c => !c.label.includes('·'))).toBe(true);
  });

  it('is not found when its laps are not loaded', () => {
    const lost = buildCompareModel({
      session,
      laps,
      traces,
      band: null,
      map,
      selection: sel({laps: [fid, 'a']}),
    });
    expect(lost.notFound).toBe(1);
  });

  it('keeps the field radar and the All laps list to this session', () => {
    const playingForeign = buildCompareModel({
      session,
      laps,
      foreign,
      traces: withTrace,
      band: null,
      map,
      selection: sel({laps: ['a', fid], hl: fid}),
    });
    expect(playingForeign.radarLap).toBeNull();
    expect(m.allLaps.flatMap(s => s.rows.map(r => r.lapId)).includes(fid)).toBe(
      false,
    );
    expect(
      buildCompareModel({
        session,
        laps,
        foreign,
        traces: withTrace,
        band: null,
        map,
        selection: sel({laps: ['a', fid], hl: 'a'}),
      }).radarLap,
    ).toMatchObject({lapId: 'a', label: 'L1'});
  });
});

describe('which lap owns the radar', () => {
  const at = (s: Partial<CompareSelection>) => build(sel(s)).radarLap;

  it('is null with the median and nothing highlighted', () => {
    expect(at({})).toBeNull();
  });
  it('is the highlighted lap, named like its chip', () => {
    expect(at({hl: 'b'})).toMatchObject({lapId: 'b', label: 'L2'});
  });
  it('is the Ref lap when nothing is highlighted, and the highlighted lap over it', () => {
    expect(at({ref: 'c'})?.lapId).toBe('c');
    expect(at({ref: 'c', hl: 'a'})?.lapId).toBe('a');
  });
  it('is null for a lap without a game lap number: it has no place in the field', () => {
    const noNumber = laps.map(l =>
      l.id === 'b' ? {...l, lapNumber: null} : l,
    );
    const m = buildCompareModel({
      session,
      laps: noNumber,
      traces,
      band: null,
      map,
      selection: sel({hl: 'b'}),
    });
    expect(m.radarLap).toBeNull();
  });
  it('stays null with one lap checked on the median: the median rule has no special case', () => {
    expect(at({laps: ['a']})).toBeNull();
    expect(at({laps: ['a'], hl: 'a'})?.lapId).toBe('a');
  });
});

describe('sectionStartM (D28 quick jump)', () => {
  it('is where the section starts on the reference lap, and the lap start when unknown', () => {
    const entry = {1: 0, 2: 812.5, 3: 1644};
    expect(sectionStartM(entry, 2)).toBe(812.5);
    expect(sectionStartM(entry, 9)).toBe(0);
  });
});
