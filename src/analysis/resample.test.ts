import {describe, expect, it} from '@jest/globals';

import {
  type RawTrace,
  gridIndex,
  medianTrace,
  resampleTrace,
  timeDiffS,
} from './resample';

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

  it('interpolates a slower channel between its real samples only', () => {
    const raw = constantLap(180);
    // Brake recorded on every other row; the rows between hold no sample.
    raw.brakePct = raw.brakePct.map((_, i) => (i % 2 ? NaN : i < 100 ? 0 : 80));
    const g = resampleTrace(raw, 1000, 5, 10);
    expect(g.brakePct.every(Number.isFinite)).toBe(true);
    expect(g.brakePct[50]).toBe(0);
    expect(g.brakePct[150]).toBe(80);
  });

  it('keeps each channel recorded samples, and only those', () => {
    const raw = constantLap(180);
    raw.brakePct = raw.brakePct.map((_, i) => (i % 2 ? NaN : i < 100 ? 0 : 80));
    const g = resampleTrace(raw, 1000, 5, 10);
    const b = g.samples.brakePct;
    // Every other row, and every value one that was recorded.
    expect(b.values.length).toBe(Math.ceil(raw.brakePct.length / 2));
    expect(new Set(b.values)).toEqual(new Set([0, 80]));
    expect(b.distanceM.every((m, i) => i === 0 || m > b.distanceM[i - 1])).toBe(
      true,
    );
    expect(g.samples.speedKph.values.length).toBe(raw.speedKph.length);
  });

  it('keeps lateral position and the edge as recorded samples, signed', () => {
    const raw = constantLap(180);
    // Lateral logged on every tenth row (10 Hz beside a 100 Hz trace).
    raw.pathLateralM = raw.lapDistPct.map((_, i) =>
      i % 10 ? NaN : i / 10 - 3,
    );
    raw.trackEdgeM = raw.lapDistPct.map((_, i) => (i % 10 ? NaN : -6.25));
    const g = resampleTrace(raw, 1000, 5, 100);
    const lateral = g.samples.pathLateralM;
    expect(lateral.values.length).toBe(Math.ceil(raw.lapDistPct.length / 10));
    expect(lateral.values[0]).toBe(-3);
    expect(lateral.values[2]).toBe(-1);
    expect(new Set(g.samples.trackEdgeM.values)).toEqual(new Set([-6.25]));
  });

  it('a trace without lateral has no lateral samples', () => {
    const g = resampleTrace(constantLap(180), 1000, 5);
    expect(g.samples.pathLateralM).toEqual({distanceM: [], values: []});
    expect(g.samples.trackEdgeM).toEqual({distanceM: [], values: []});
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

describe('medianTrace', () => {
  const lapAt = (kph: number) => resampleTrace(constantLap(kph), 1000, 5, 10);

  it('takes the median of each channel at every grid point', () => {
    const m = medianTrace([lapAt(150), lapAt(180), lapAt(240)]);
    expect(m.distanceM).toHaveLength(201);
    expect(m.speedKph[100]).toBeCloseTo(180);
    expect(m.gear[10]).toBe(3);
    expect(m.gear[190]).toBe(4);
  });

  it('ends its elapsed time on the median official lap time', () => {
    const laps = [lapAt(150), lapAt(180), lapAt(240)];
    const official = [24.4, 20.2, 15.1];
    const m = medianTrace(laps, official);
    expect(m.timeS[200]).toBeCloseTo(20.2, 6);
    expect(m.timeS[0]).toBeCloseTo(0, 1);
  });

  it('is the midpoint of two laps', () => {
    const m = medianTrace([lapAt(150), lapAt(210)], [24, 17]);
    expect(m.timeS[200]).toBeCloseTo(20.5, 6);
    expect(m.speedKph[100]).toBeCloseTo(180);
  });

  it('stops where the shortest trace stops', () => {
    const short = lapAt(180);
    short.distanceM = short.distanceM.slice(0, 100);
    short.timeS = short.timeS.slice(0, 100);
    expect(medianTrace([short, lapAt(180)]).distanceM).toHaveLength(100);
  });

  it('refuses an empty set', () => {
    expect(() => medianTrace([])).toThrow();
  });
});
