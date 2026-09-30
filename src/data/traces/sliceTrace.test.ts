import {describe, expect, it} from '@jest/globals';

import {
  gridOf,
  LENGTH_M,
  sliceFileJson,
  sliceLapJson,
  STEP_M,
  syntheticRaw,
} from '@/src/analysis/__fixtures__/sliceFile';
import {decodeCornerSlices} from '@/src/analysis/cornerSlices';

import {sliceToGridTrace} from './sliceTrace';

const WINDOW: [number, number] = [650, 1150];

describe('sliceToGridTrace', () => {
  const grid = gridOf(syntheticRaw());
  const slices = decodeCornerSlices(
    sliceFileJson([sliceLapJson('a', grid, WINDOW)], 900, WINDOW),
  );
  const trace = sliceToGridTrace(slices.laps[0], slices);

  it('is a whole-lap grid like resampleTrace gives, so the screen reads it unchanged', () => {
    expect(trace.stepM).toBe(STEP_M);
    expect(trace.distanceM).toHaveLength(LENGTH_M / STEP_M + 1);
    expect(trace.speedKph).toHaveLength(trace.distanceM.length);
    expect(trace.timeS).toHaveLength(trace.distanceM.length);
  });

  it('inside the window it agrees with the whole-lap grid', () => {
    for (let i = 650 / STEP_M; i <= 1150 / STEP_M; i++) {
      expect(trace.speedKph[i]).toBeCloseTo(grid.speedKph[i], 2);
      expect(trace.brakePct[i]).toBeCloseTo(grid.brakePct[i], 0);
      expect(trace.throttlePct[i]).toBeCloseTo(grid.throttlePct[i], 0);
      expect(trace.steeringPct[i]).toBeCloseTo(grid.steeringPct[i], 2);
      expect(trace.timeS[i]).toBeCloseTo(grid.timeS[i], 3);
    }
  });

  it('outside the window there is nothing, not a zero', () => {
    for (const i of [0, 100, 129, 231, 300]) {
      expect(trace.speedKph[i]).toBeNaN();
      expect(trace.timeS[i]).toBeNaN();
    }
  });

  it('keeps the recorded samples themselves', () => {
    expect(trace.samples.brakePct.values.length).toBeGreaterThan(0);
    expect(trace.samples.brakePct.values.length).toBe(
      slices.laps[0].samples.brakePct.values.length,
    );
    expect(trace.samples.gear.values).toEqual([]);
  });

  it('a lap with no position has empty lat and lon, so the map is left out', () => {
    const noPos = {...slices.laps[0], lat: [], lon: []};
    const t = sliceToGridTrace(noPos, slices);
    expect(t.lat.every(Number.isNaN)).toBe(true);
    expect(t.lon.every(Number.isNaN)).toBe(true);
  });
});
