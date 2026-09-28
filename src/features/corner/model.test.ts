import {describe, expect, it} from '@jest/globals';

// Adapters are internal to data/; tests reach them to build real shapes.
import {
  toLaps,
  toSessionDetail,
  toTrackMap,
} from '@/src/data/sessions/adapters';

import {buildCornerModel, cornerLapIds, sortRows, traceIdsFor} from './model';

const session = toSessionDetail({
  id: 's1',
  sim: 'lmu',
  track: {name: 'Test Ring'},
  car: {name: 'Manthey DK Engineering 2026 #91:LM'},
  sessionType: 'Race',
  startedAt: '2026-09-26T00:00:00Z',
  stints: [],
});

const map = toTrackMap({
  lengthM: 1000,
  corners: [
    {n: 1, entryM: 100, apexM: 200, exitM: 300, parts: [{n: 1, apexM: 200}]},
    {
      n: 2,
      entryM: 500,
      apexM: 600,
      exitM: 700,
      parts: [
        {n: 2, apexM: 560},
        {n: 3, apexM: 640},
      ],
    },
  ],
  outline: {features: []},
});

// Section 2 facts per lap: time, brake at (absolute m), min speed, full throttle at.
const lap = (id: string, s2: [number, number, number, number], ok = true) => ({
  id,
  lapTime: 20,
  comparable: ok,
  reasons: [],
  corners: [
    {segTime: 5, parts: []},
    {
      segTime: s2[0],
      brakeAtM: s2[1],
      minSpeedKmh: s2[2],
      fullThrottleAtM: s2[3],
      parts: [],
    },
  ],
});
const laps = toLaps([
  lap('a', [9.8, 460, 110, 650]),
  lap('b', [10.1, 450, 106, 670]),
  lap('c', [9.7, 470, 112, 640]),
  lap('x', [12.0, 400, 90, 700], false),
]);

const build = (lapIds: string[], hl: string | null = null) =>
  buildCornerModel({
    session,
    laps,
    map,
    band: null,
    traces: new Map(),
    lapIds,
    hl,
    section: 2,
  })!;

describe('buildCornerModel', () => {
  const m = build(['a', 'b', 'c']);

  it('header names the section and its corners', () => {
    expect(m.title).toBe('Section 2');
    expect(m.subtitle).toBe('600 m · C2–C3 · 3 laps · compared with L1');
    expect(m.prev).toBe(1);
    expect(m.next).toBe(1);
  });

  it('brake and throttle are relative to the apex', () => {
    expect(m.rows[0].values).toEqual({
      time: 9.8,
      brake: 140,
      minSpeed: 110,
      throttle: 50,
    });
  });

  it('gaps to the reference; better depends on the measure', () => {
    const b = m.rows[1].cells;
    expect(b.time).toEqual({value: '10.100', gap: '+0.300', better: false});
    // Brakes 10 m earlier (150 m before the apex vs 140): lower is better.
    expect(b.brake).toEqual({value: '150', gap: '+10', better: false});
    expect(b.minSpeed).toEqual({value: '106', gap: '−4', better: false});
    expect(m.rows[0].cells.time.gap).toBeNull();
  });

  it('highlight line for the highlighted lap', () => {
    expect(m.highlightLine).toBe(
      'L2: 10.100 s · brake 150 m · min 106 km/h · full throttle 70 m',
    );
  });

  it('zoom window is apex −250 m to +150 m', () => {
    expect(m.zoom.windowM).toEqual([350, 750]);
    expect(m.explainer).toMatch(
      /entry \(500 m\) to the next section's entry \(100 m\)/,
    );
  });

  it('table below 20 laps, no strips', () => {
    expect(m.strips).toBeNull();
    expect(m.mode).toBe('individual');
  });
});

describe('strips at 20+ laps', () => {
  const many = toLaps(
    Array.from({length: 20}, (_, i) =>
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
    hl: 'm3',
    section: 2,
  })!;

  it('four strips with summary; brake axis flipped', () => {
    expect(m.strips!.map(s => s.measure)).toEqual([
      'time',
      'brake',
      'minSpeed',
      'throttle',
    ]);
    expect(m.strips![1].flipped).toBe(true);
    expect(m.strips![0].summary).toMatch(/^med 10\.200 · p10–90 /);
  });

  it('equal values stack alternately', () => {
    const throttle = m.strips![3].dots.map(d => d.stack);
    expect(throttle.slice(0, 5)).toEqual([0, 1, -1, 2, -2]);
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

  it('traces for every lap when few, key laps only when many', () => {
    expect(traceIdsFor(['a', 'b', 'c'], null)).toEqual(['a', 'b', 'c']);
    const ids = Array.from({length: 8}, (_, i) => `l${i}`);
    expect(traceIdsFor(ids, 'l5')).toEqual(['l0', 'l5']);
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
