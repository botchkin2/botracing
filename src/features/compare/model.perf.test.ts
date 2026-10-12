import {describe, expect, it} from '@jest/globals';

import {type RawTrace, resampleTrace} from '@/src/analysis/resample';
// Adapters are internal to data/; tests reach them to build real shapes.
import {toLaps, toSessionDetail} from '@/src/data/sessions/adapters';

import {medianBasisOf} from '@/src/analysis/medianBasis';
import {buildCompareModel, buildCompareSet} from './model';

// A cursor step at 60 laps (pit-wall thread 1 #3243 to #3245): Compare
// rebuilds its model on every step, and a full scan of every lap per chart
// made that 46 ms on a desktop CPU. Times are in units of a baseline measured
// in the same run on the same machine: one plain pass over every lap's grid
// channels. A fixed ms ceiling flaked on CI runners about 8x slower than the
// 7900X (2.1 ms against 2, apex #4468). On the 7900X a whole rebuild is about
// 0.75 passes and a cursor step on a kept set (buildCompareSet, what the
// screen does) about 0.38, alone or with six runs at once; each ceiling sits
// about 2.6x above, and a step made 5x slower reads 3.6 and 1.8 and fails.
const LAPS = 60;
const LENGTH_M = 4000;
const STEP_CEILING_SCANS = 2;
const CURSOR_CEILING_SCANS = 1;
const BATCHES = 15;

/**
 * The median per-call time of `fn` against `baseline`, in baselines: the two
 * run in alternating batches so a slow stretch of the runner hits both, and
 * the median batch ignores the outliers.
 */
function inBaselines(
  label: string,
  fn: () => void,
  baseline: () => void,
  perBatch: number,
) {
  const time = (f: () => void) => {
    const t0 = performance.now();
    for (let i = 0; i < perBatch; i++) f();
    return (performance.now() - t0) / perBatch;
  };
  for (let i = 0; i < 20; i++) {
    fn();
    baseline();
  }
  const ratios: number[] = [];
  for (let b = 0; b < BATCHES; b++) ratios.push(time(fn) / time(baseline));
  ratios.sort((a, b) => a - b);
  const median = ratios[Math.floor(BATCHES / 2)];
  // In the CI log, so the headroom on a runner is read, not assumed (brake #4470).
  console.log(`perf ratio ${label}: ${median.toFixed(3)} passes`);
  return median;
}

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
  // The baseline: one plain pass over every lap's grid channels.
  let sink = 0;
  const scan = () => {
    for (const t of traces.values())
      for (const ch of [
        t.speedKph,
        t.throttlePct,
        t.brakePct,
        t.steeringPct,
        t.gear,
        t.lat,
        t.lon,
      ])
        for (let i = 0; i < ch.length; i++) sink += ch[i];
  };

  it(`a cursor step stays under ${STEP_CEILING_SCANS} passes over the laps`, () => {
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
    // inBaselines warms first: the first build fills the per-array caches.
    expect(inBaselines('rebuild', step, scan, 30)).toBeLessThan(
      STEP_CEILING_SCANS,
    );
    expect(sink).toBeGreaterThan(0);
  });

  it(`a cursor step on a kept set stays under ${CURSOR_CEILING_SCANS} pass over the laps`, () => {
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
    expect(inBaselines('cursor', step, scan, 60)).toBeLessThan(
      CURSOR_CEILING_SCANS,
    );
  });
});
