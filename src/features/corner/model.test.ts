import {describe, expect, it} from '@jest/globals';

// Adapters are internal to data/; tests reach them to build real shapes.
import {
  toLaps,
  toSessionDetail,
  toTrackMap,
} from '@/src/data/sessions/adapters';

import {
  buildCornerModel,
  cornerLapIds,
  MEASURES,
  referenceFirst,
  sortRows,
  buildBrakeMap,
} from './model';

const session = toSessionDetail({
  id: 's1',
  sim: 'lmu',
  track: {name: 'Test Ring'},
  car: {name: 'Manthey DK Engineering 2026 #91:LM'},
  sessionType: 'Race',
  startedAt: '2026-09-26T00:00:00Z',
  stints: [],
});

// S1 = C1 (no parts); S2 = C2–C3.
const map = toTrackMap({
  lengthM: 1000,
  corners: [
    {n: 1, entryM: 100, apexM: 200, exitM: 300, parts: []},
    {
      n: 2,
      entryM: 500,
      apexM: 600,
      exitM: 700,
      parts: [
        {n: 2, entryM: 500, apexM: 560, exitM: 600},
        {n: 3, entryM: 600, apexM: 640, exitM: 700},
      ],
    },
  ],
  outline: {features: []},
});

// C3 facts per lap: time, brake at (absolute m), min speed, full throttle at.
// The section's own facts are deliberately different: Corner must read C3.
const lap = (
  id: string,
  c3: [number, number, number, number],
  ok = true,
  flat = false,
) => ({
  id,
  lapTime: 20,
  comparable: ok,
  reasons: [],
  corners: [
    {segTime: 5, parts: []},
    {
      segTime: 99,
      brakeAtM: 1,
      // One brake application per corner, each by the corner it is for.
      brakeApps: [
        {onsetM: 450, peakPct: 80, part: 2},
        {onsetM: 620, peakPct: 95, part: 3},
      ],
      parts: [
        {segTime: 1, brakeAtM: 480},
        {
          segTime: c3[0],
          brakeAtM: c3[1],
          minSpeedKmh: c3[2],
          fullThrottleAtM: c3[3],
          fullThrottleAtEdge: flat,
        },
      ],
    },
  ],
});
const laps = toLaps([
  lap('a', [9.8, 460, 110, 650]),
  lap('b', [10.1, 450, 106, 670]),
  lap('c', [9.7, 470, 112, 640]),
  lap('x', [12.0, 400, 90, 700], false),
]);

const build = (lapIds: string[], hl: string | null = null, corner = 3) =>
  buildCornerModel({
    session,
    laps,
    map,
    band: null,
    traces: new Map(),
    lapIds,
    keyLapIds: lapIds.length < 7 ? lapIds : [lapIds[0], hl ?? lapIds[1]],
    hl,
    corner,
  })!;

describe('a lap at full throttle by the slowest point', () => {
  const flatLaps = toLaps([
    lap('a', [9.8, 460, 110, 650]),
    lap('f', [10.1, 450, 106, 590], true, true),
  ]);
  const model = buildCornerModel({
    session,
    laps: flatLaps,
    map,
    band: null,
    traces: new Map(),
    lapIds: ['a', 'f'],
    keyLapIds: ['a', 'f'],
    hl: 'f',
    corner: 3,
  })!;

  it('has no full-throttle value: the cell says at min, the value is null', () => {
    expect(model.rows[1].values.throttle).toBeNull();
    expect(model.rows[1].cells.throttle).toEqual({
      value: 'at min',
      gap: null,
      better: false,
    });
    expect(model.rows[0].cells.throttle.value).toBe('10');
  });
});

describe('buildCornerModel (per single corner)', () => {
  const m = build(['a', 'b', 'c']);

  it('header names the corner and its section', () => {
    expect(m.title).toBe('Turn 3');
    expect(m.subtitle).toBe(
      '640 m · in S2 (T2–T3) · 3 laps · compared with L1',
    );
    expect(m.sectionN).toBe(2);
    expect(m.corners).toEqual([
      {n: 1, label: 'T1'},
      {n: 2, label: 'T2'},
      {n: 3, label: 'T3'},
    ]);
    expect(m.prev).toBe(2);
    expect(m.next).toBe(1);
  });

  it('reads the corner’s own facts; brake and throttle relative to its apex', () => {
    expect(m.rows[0].values).toEqual({
      time: 9.8,
      brake: 180,
      peakBrake: 95,
      minSpeed: 110,
      throttle: 10,
    });
  });

  it('takes the peak brake of the application for this corner (part 3, not part 2)', () => {
    expect(m.rows.map(r => r.values.peakBrake)).toEqual([95, 95, 95]);
    expect(m.rows[0].cells.peakBrake).toEqual({
      value: '95',
      gap: null,
      better: false,
    });
    // No good or bad side for peak pressure: the gap is shown, never coloured as better.
    expect(MEASURES.find(x => x.id === 'peakBrake')?.better).toBeNull();
  });

  it('gaps to the reference; better depends on the measure', () => {
    const b = m.rows[1].cells;
    expect(b.time).toEqual({value: '10.100', gap: '+0.300', better: false});
    // Brakes 10 m earlier (190 m before the apex vs 180): lower is better.
    expect(b.brake).toEqual({value: '190', gap: '+10', better: false});
    expect(b.minSpeed).toEqual({value: '106', gap: '−4', better: false});
    expect(m.rows[0].cells.time.gap).toBeNull();
  });

  it('zoom window is apex −250 m to +150 m', () => {
    expect(m.zoom.windowM).toEqual([390, 790]);
  });

  it('a section without parts is one corner', () => {
    const c1 = build(['a'], null, 1);
    expect(c1.subtitle).toMatch(/in S1 \(T1\)/);
    expect(c1.rows[0].values.time).toBe(5);
  });

  it('table below 7 laps, no strips', () => {
    expect(m.strips).toBeNull();
    expect(m.mode).toBe('individual');
  });
});

describe('strips at 7+ laps', () => {
  const many = toLaps(
    Array.from({length: 7}, (_, i) =>
      lap(`m${i}`, [10 + (i % 5) / 10, 450 + i, 100 + i, 650]),
    ),
  );
  const m = buildCornerModel({
    session,
    laps: many,
    map,
    band: null,
    traces: new Map(),
    lapIds: many.map(l => l.id),
    keyLapIds: ['m0', 'm3'],
    hl: 'm3',
    corner: 3,
  })!;

  it('four strips with summary; brake axis in track order', () => {
    expect(m.strips!.map(s => s.measure)).toEqual([
      'time',
      'brake',
      'minSpeed',
      'throttle',
    ]);
    expect(m.strips![1].flipped).toBe(true);
    expect(m.strips![0].summary).toMatch(/^med 10\.100 · p10–90 /);
  });

  it('colours the laps on and gives their values beside the title', () => {
    const on = m.strips![0].dots.filter(d => d.onIndex != null);
    expect(on.map(d => [d.lapId, d.onIndex])).toEqual([
      ['m0', 0],
      ['m3', 1],
    ]);
    expect(m.strips![0].keyValues.map(k => k.onIndex)).toEqual([0, 1]);
  });
});

describe('lap choice', () => {
  it('all comparable keeps the reference first and skips excluded laps', () => {
    expect(cornerLapIds(laps, {laps: ['c'], hl: null}, true)).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(cornerLapIds(laps, {laps: ['c', 'x'], hl: null}, false)).toEqual([
      'c',
      'x',
    ]);
  });

  it('with nothing selected, the best lap is the reference', () => {
    expect(cornerLapIds(laps, {laps: [], hl: null}, true, 'b')).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('with nothing selected and all-comparable off, falls back to best + next fastest', () => {
    const timed = toLaps([
      {...lap('a', [9.8, 460, 110, 650]), lapTime: 91},
      {...lap('b', [10.1, 450, 106, 670]), lapTime: 90},
      {...lap('c', [9.7, 470, 112, 640]), lapTime: 92},
      {...lap('x', [12.0, 400, 90, 700], false), lapTime: 80},
    ]);
    expect(cornerLapIds(timed, {laps: [], hl: null}, false, 'b')).toEqual([
      'b',
      'a',
    ]);
    expect(cornerLapIds(timed, {laps: [], hl: null}, false, null)).toEqual([
      'b',
      'a',
    ]);
    expect(cornerLapIds([], {laps: [], hl: null}, false, null)).toEqual([]);
  });

  it('puts the Ref lap first, else the quickest checked lap', () => {
    const timed = toLaps([
      {...lap('a', [9.8, 460, 110, 650]), lapTime: 91},
      {...lap('b', [10.1, 450, 106, 670]), lapTime: 90},
      {...lap('c', [9.7, 470, 112, 640]), lapTime: 92},
    ]);
    const sel = (over: Partial<Parameters<typeof referenceFirst>[0]>) => ({
      laps: ['a', 'b', 'c'],
      hl: null,
      ...over,
    });
    // Compare keeps lap-number order, so the first is not a choice.
    expect(referenceFirst(sel({}), timed).laps).toEqual(['b', 'a', 'c']);
    expect(referenceFirst(sel({ref: 'c'}), timed).laps).toEqual(['c', 'a', 'b']);
    expect(referenceFirst(sel({ref: 'x'}), timed).laps).toEqual(['b', 'a', 'c']);
    const first = sel({laps: ['b', 'a']});
    expect(referenceFirst(first, timed)).toBe(first);
    expect(referenceFirst(sel({laps: []}), timed).laps).toEqual([]);
  });

  it('sorts by a measure', () => {
    const m = build(['a', 'b', 'c']);
    expect(sortRows(m.rows, 'time', 'asc').map(r => r.label)).toEqual([
      'L3',
      'L1',
      'L2',
    ]);
    expect(sortRows(m.rows, 'minSpeed', 'desc')[0].label).toBe('L3');
  });
});

describe('buildBrakeMap', () => {
  // A straight line north: 1 m per step, 0.00001° lat ≈ 1.11 m.
  const n = 1000;
  const trace = {
    stepM: 1,
    distanceM: Array.from({length: n}, (_, i) => i),
    lat: Array.from({length: n}, (_, i) => i * 0.00001),
    lon: Array.from({length: n}, () => 0),
  } as unknown as Parameters<typeof buildBrakeMap>[1];
  const row = (
    lapId: string,
    brake: number | null,
    throttle: number | null,
    extra = {},
  ) =>
    ({
      lapId,
      selIndex: 0,
      isRef: false,
      highlighted: false,
      values: {time: 1, brake, minSpeed: 100, throttle},
      ...extra,
    } as unknown as Parameters<typeof buildBrakeMap>[0][number]);

  it('places every lap’s points on the reference line, window only', () => {
    const m = buildBrakeMap(
      [row('a', 100, 50, {isRef: true}), row('b', 500, null)],
      trace,
      500,
    )!;
    expect(m.centreline).toHaveLength(551);
    // Brake 100 m before the apex sits 250 m into the window (≈278 m north).
    expect(m.brakes.map(p => p.lapId)).toEqual(['a']);
    expect(m.brakes[0].at.y).toBeCloseTo(m.apex.y - 100 * 1.11, -1);
    expect(m.throttles[0].at.y).toBeGreaterThan(m.apex.y);
    expect(m.ticks.map(t => t.label)).toEqual([
      '−300 m',
      '−200 m',
      '−100 m',
      '+100 m',
    ]);
  });

  it('is null without the reference trace', () => {
    expect(buildBrakeMap([], undefined, 500)).toBeNull();
  });
});
