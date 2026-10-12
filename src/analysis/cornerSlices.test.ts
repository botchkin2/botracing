import {describe, expect, it} from '@jest/globals';

import {
  gridOf,
  sliceFileJson,
  sliceLapJson,
  syntheticRaw,
} from './__fixtures__/sliceFile';
import {
  decodeCornerSlices,
  gridFromSamples,
  steppedFromSamples,
} from './cornerSlices';
import {sliceSamples} from './nativeSamples';

const WINDOW: [number, number] = [650, 1150];

describe('decodeCornerSlices', () => {
  const grid = gridOf(syntheticRaw());
  const file = sliceFileJson(
    [sliceLapJson('lap-a', grid, WINDOW)],
    900,
    WINDOW,
  );

  it('gives back the recorded samples, rounded to the file precision', () => {
    const got = decodeCornerSlices(file).laps[0];
    const want = sliceSamples(grid.samples.brakePct, WINDOW[0], WINDOW[1]);
    expect(got.samples.brakePct.distanceM).toHaveLength(want.distanceM.length);
    got.samples.brakePct.distanceM.forEach((d, i) => {
      expect(d).toBeCloseTo(want.distanceM[i], 3);
      expect(got.samples.brakePct.values[i]).toBeCloseTo(want.values[i], 2);
    });
    expect(got.id).toBe('lap-a');
  });

  it('keeps a slower channel at its own rate: brake has half the samples of speed', () => {
    const {samples} = decodeCornerSlices(file).laps[0];
    const ratio =
      samples.speedKph.values.length / samples.brakePct.values.length;
    expect(ratio).toBeGreaterThan(1.9);
    expect(ratio).toBeLessThan(2.1);
  });

  it('reads the grid time from gridFromM', () => {
    const lap = decodeCornerSlices(file).laps[0];
    expect(lap.gridFromM).toBe(650);
    lap.timeS.forEach((t, k) =>
      expect(t).toBeCloseTo(grid.timeS[650 / 5 + k], 3),
    );
  });

  it('names what is wrong', () => {
    expect(() => decodeCornerSlices(null)).toThrow('not an object');
    expect(() => decodeCornerSlices({...file, v: 3})).toThrow('unknown format');
    expect(() => decodeCornerSlices({...file, windowM: [1]})).toThrow(
      'windowM',
    );
    const bad = JSON.parse(JSON.stringify(file));
    bad.laps[0].samples.speedKph.v = 'x';
    expect(() => decodeCornerSlices(bad)).toThrow(
      'laps[0].speedKph.v is not an array',
    );
    delete bad.laps[0].samples.speedKph;
    expect(() => decodeCornerSlices(bad)).toThrow(
      'samples.speedKph is missing',
    );
  });
});

describe('format 1 and gear', () => {
  const file = sliceFileJson(
    [sliceLapJson('lap-a', gridOf(syntheticRaw()), WINDOW)],
    900,
    WINDOW,
  );
  it('reads a format 1 file with no gear samples, as an empty gear channel', () => {
    const v1 = JSON.parse(JSON.stringify(file));
    v1.v = 1;
    delete v1.laps[0].samples.gear;
    const decoded = decodeCornerSlices(v1);
    expect(decoded.laps[0].samples.gear).toEqual({distanceM: [], values: []});
  });

  it('a format 2 file must carry gear', () => {
    const v2 = JSON.parse(JSON.stringify(file));
    delete v2.laps[0].samples.gear;
    expect(() => decodeCornerSlices(v2)).toThrow('samples.gear is missing');
  });
});

describe('steppedFromSamples', () => {
  it('holds each recorded gear until the next sample', () => {
    const s = {distanceM: [10, 20, 30], values: [2, 3, 4]};
    expect(steppedFromSamples(s, [0, 10, 15, 20, 25, 35])).toEqual([
      2, 2, 2, 3, 3, 4,
    ]);
  });
});

describe('gridFromSamples', () => {
  it('interpolates between recorded samples and holds the ends', () => {
    const s = {distanceM: [10, 20], values: [0, 100]};
    expect(gridFromSamples(s, [0, 10, 15, 20, 30])).toEqual([
      0, 0, 50, 100, 100,
    ]);
  });

  it('is NaN for a channel with no samples, never a made-up zero', () => {
    const got = gridFromSamples({distanceM: [], values: []}, [0, 5]);
    expect(got.every(Number.isNaN)).toBe(true);
  });
});
