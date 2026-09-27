import {describe, expect, it} from '@jest/globals';

import {type RawTrace, gridIndex, resampleTrace, timeDiffS} from './resample';

// A lap at constant speed over a 1000 m track, sampled at 10 Hz.
function constantLap(speedKph: number, lengthM = 1000): RawTrace {
  const v = speedKph / 3.6;
  const samples = Math.ceil(lengthM / v / 0.1) + 1;
  const pct = Array.from({length: samples}, (_, i) =>
    Math.min(1, (i * 0.1 * v) / lengthM),
  );
  const same = (x: number) => pct.map(() => x);
  return {
    lapDistPct: pct,
    speedKph: same(speedKph),
    throttlePct: same(100),
    brakePct: same(0),
    steeringPct: same(0),
    gear: pct.map(p => (p < 0.5 ? 3 : 4)),
    lat: pct,
    lon: same(0),
  };
}

describe('resampleTrace', () => {
  it('puts the lap on a fixed distance grid', () => {
    const g = resampleTrace(constantLap(180), 1000, 5);
    expect(g.distanceM).toHaveLength(201);
    expect(g.distanceM[200]).toBe(1000);
    expect(g.speedKph[100]).toBeCloseTo(180);
  });

  it('takes time from the sample rate', () => {
    const g = resampleTrace(constantLap(180), 1000, 5, 10);
    // 1000 m at 50 m/s, sampled at 10 Hz
    expect(g.timeS[200]).toBeCloseTo(20, 1);
  });

  it('steps discrete channels instead of blending them', () => {
    const g = resampleTrace(constantLap(180), 1000, 5);
    expect(new Set(g.gear)).toEqual(new Set([3, 4]));
  });

  it('drops the wrap at the line', () => {
    const raw = constantLap(180);
    raw.lapDistPct.push(0.001);
    for (const k of [
      'speedKph',
      'throttlePct',
      'brakePct',
      'steeringPct',
      'gear',
      'lat',
      'lon',
    ] as const)
      raw[k].push(raw[k][0]);
    const g = resampleTrace(raw, 1000, 5);
    expect(g.lat[200]).toBeCloseTo(1);
  });
});

describe('timeDiffS', () => {
  it('is positive where the lap is behind the reference', () => {
    const ref = resampleTrace(constantLap(200), 1000, 5, 10);
    const lap = resampleTrace(constantLap(180), 1000, 5, 10);
    const d = timeDiffS(lap, ref);
    expect(d[0]).toBe(0);
    expect(d[200]).toBeCloseTo(1000 / 50 - 1000 / (200 / 3.6), 1);
  });
});

it('pins the end to the official gap when given', () => {
  const ref = resampleTrace(constantLap(200), 1000, 5, 10);
  const lap = resampleTrace(constantLap(180), 1000, 5, 10);
  const d = timeDiffS(lap, ref, {lapS: 20.1, refS: 18.0});
  expect(d[0]).toBe(0);
  expect(d[200]).toBeCloseTo(2.1, 10);
});

describe('gridIndex', () => {
  it('rounds to the nearest point and clamps', () => {
    const g = resampleTrace(constantLap(180), 1000, 5);
    expect(gridIndex(g, 12)).toBe(2);
    expect(gridIndex(g, -3)).toBe(0);
    expect(gridIndex(g, 5000)).toBe(200);
  });
});
