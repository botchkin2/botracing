import {describe, expect, it} from '@jest/globals';

import {type RawTrace, resampleTrace} from '@/src/analysis/resample';
// Adapters are internal to data/; tests reach them to build real shapes.
import {toLaps, toSessionDetail} from '@/src/data/sessions/adapters';

import {medianBasisOf} from '@/src/analysis/medianBasis';
import {buildCompareModel, buildCompareSet} from './model';

// A cursor step at 60 laps (pit-wall thread 1 #3243 to #3245): Compare
// rebuilds its model on every step, and a full scan of every lap per chart
// made that 46 ms on a desktop CPU. The ceiling is loose so CI noise never
// flakes it. On the 7900X a whole rebuild is about 1.3 ms and a cursor step
// on a kept set (buildCompareSet, what the screen does) about 0.25 ms.
const LAPS = 60;
const LENGTH_M = 4000;
const STEP_CEILING_MS = 10;
const CURSOR_CEILING_MS = 2;

// A lap with speed, pedals and steering that vary along it, as real ones do.
function lap(seed: number): RawTrace {
  const n = 2000;
  const pct = Array.from({length: n}, (_, i) => i / (n - 1));
  const wave = (k: number, a: number, b: number) =>
    pct.map(p => a + b * Math.sin(2 * Math.PI * k * p + seed));
  return {
    lapDistPct: pct,
    speedKph: wave(7, 160, 70),
    throttlePct: wave(7, 60, 40),
    brakePct: wave(7, 20, 20),
    steeringPct: wave(11, 0, 30),
    gear: wave(7, 4, 2).map(Math.round),
    lat: pct.map(p => 60 + Math.sin(2 * Math.PI * p) / 200),
    lon: pct.map(p => Math.cos(2 * Math.PI * p) / 100),
  };
}

describe('Compare at 60 laps', () => {
  const session = toSessionDetail({
    id: 's1',
    sim: 'lmu',
    track: {name: 'Test Ring', variant: 'Test Ring'},
    car: {name: 'GT3'},
    sessionType: 'Race',
    startedAt: '2026-10-01T00:00:00Z',
    bestLapId: 'l0',
    medianLapTime: 100,
    stints: [],
  });
  const laps = toLaps(
    Array.from({length: LAPS}, (_, i) => ({
      id: `l${i}`,
      lapNumber: i + 1,
      lapTime: 100 + (i % 7) * 0.1,
      comparable: true,
      reasons: [],
      corners: [],
    })),
  );
  const traces = new Map(
    laps.map((l, i) => [l.id, resampleTrace(lap(i / 10), LENGTH_M, 5)]),
  );
  const ids = laps.map(l => l.id);
  const basisTrace = medianBasisOf(laps, traces);

  it(`a cursor step stays under ${STEP_CEILING_MS} ms`, () => {
    let cursorM = 0;
    const step = () => {
      cursorM = (cursorM + 37) % LENGTH_M;
      buildCompareModel({
        session,
        laps,
        traces,
        band: null,
        map: null,
        basisTrace,
        selection: {laps: ids, ref: null, hl: null, corner: null, cursorM},
      });
    };
    // Warm: the first build fills the per-array caches.
    for (let i = 0; i < 20; i++) step();
    const n = 100;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) step();
    expect((performance.now() - t0) / n).toBeLessThan(STEP_CEILING_MS);
  });

  it(`a cursor step on a kept set stays under ${CURSOR_CEILING_MS} ms`, () => {
    const set = buildCompareSet({
      session,
      laps,
      traces,
      band: null,
      map: null,
      basisTrace,
      selection: {laps: ids, ref: null, hl: null, corner: null},
    });
    let cursorM = 0;
    const step = () => {
      cursorM = (cursorM + 37) % LENGTH_M;
      set.atCursor(cursorM);
    };
    for (let i = 0; i < 20; i++) step();
    const n = 200;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) step();
    expect((performance.now() - t0) / n).toBeLessThan(CURSOR_CEILING_MS);
  });
});
