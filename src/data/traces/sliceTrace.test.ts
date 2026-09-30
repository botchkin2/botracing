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

import {sliceReachesApex, sliceToGridTrace} from './sliceTrace';

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

  it('outside the window the ends are held, never NaN: the line builder cannot take one', () => {
    const inFirst = 650 / STEP_M;
    for (const i of [0, 100, 129, 231, 300, LENGTH_M / STEP_M]) {
      expect(trace.speedKph[i]).not.toBeNaN();
      expect(trace.timeS[i]).not.toBeNaN();
      expect(trace.lat[i]).not.toBeNaN();
    }
    // The end values held: the first and last recorded speed samples.
    const speed = slices.laps[0].samples.speedKph.values;
    expect(trace.speedKph[0]).toBeCloseTo(speed[0], 3);
    expect(trace.speedKph[LENGTH_M / STEP_M]).toBeCloseTo(speed.at(-1)!, 3);
    expect(trace.timeS[0]).toBe(trace.timeS[inFirst]);
  });

  it('keeps the recorded samples themselves', () => {
    expect(trace.samples.brakePct.values.length).toBeGreaterThan(0);
    expect(trace.samples.brakePct.values.length).toBe(
      slices.laps[0].samples.brakePct.values.length,
    );
    expect(trace.samples.gear.values).toEqual([]);
  });

  it('a lap with no position has NaN lat and lon, so the map is left out', () => {
    const noPos = {...slices.laps[0], lat: [], lon: []};
    const t = sliceToGridTrace(noPos, slices);
    expect(t.lat.every(Number.isNaN)).toBe(true);
    expect(t.lon.every(Number.isNaN)).toBe(true);
  });
});

describe('sliceReachesApex', () => {
  const grid = gridOf(syntheticRaw());
  const slices = decodeCornerSlices(
    sliceFileJson([sliceLapJson('a', grid, WINDOW)], 900, WINDOW),
  );
  const lap = slices.laps[0];

  it('a lap with samples on both sides of the apex reaches it', () => {
    expect(sliceReachesApex(lap, slices)).toBe(true);
  });

  it('an out lap with one stray sample far along the track does not', () => {
    const stray = {
      ...lap,
      samples: {
        ...lap.samples,
        speedKph: {distanceM: [2481], values: [80]},
      },
    };
    expect(sliceReachesApex(stray, slices)).toBe(false);
  });

  it('a lap that ended before the apex does not', () => {
    const short = {
      ...lap,
      samples: {
        ...lap.samples,
        speedKph: {distanceM: [650, 700, 800], values: [1, 2, 3]},
      },
    };
    expect(sliceReachesApex(short, slices)).toBe(false);
  });
});
