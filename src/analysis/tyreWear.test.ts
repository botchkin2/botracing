import {describe, expect, it} from '@jest/globals';

import {
  jointFit,
  leastSquares,
  MIN_BAND_LAPS,
  type WearLap,
  wearBands,
} from './tyreWear';

const lap = (i: number, lostPct: number, timeS: number, fuelStartL = 40) => ({
  lapId: `l${i}`,
  timeS,
  lostPct,
  fuelStartL,
});

describe('leastSquares', () => {
  it('finds the line through points on it', () => {
    const fit = leastSquares([
      {x: 0, y: 100},
      {x: 10, y: 101},
      {x: 20, y: 102},
    ]);
    expect(fit?.slope).toBeCloseTo(0.1);
    expect(fit?.intercept).toBeCloseTo(100);
  });

  it('has no line for one point or one x', () => {
    expect(leastSquares([{x: 1, y: 1}])).toBeNull();
    expect(
      leastSquares([
        {x: 1, y: 1},
        {x: 1, y: 2},
      ]),
    ).toBeNull();
  });
});

describe('wearBands', () => {
  it('one band with a line when there are few laps but enough for a fit', () => {
    const laps = Array.from({length: MIN_BAND_LAPS}, (_, i) =>
      lap(i, i * 3, 100 + i * 0.3),
    );
    const [b] = wearBands(laps);
    expect(b.label).toBe('All fuel loads');
    expect(b.empty).toBeNull();
    expect(b.line?.x1).toBe(0);
    expect(b.line?.x2).toBe(12);
  });

  it('too few laps in a band: no line, says why', () => {
    const [b] = wearBands([lap(1, 1, 100), lap(2, 5, 101)]);
    expect(b.empty).toBe('few-laps');
    expect(b.line).toBeNull();
  });

  it('laps that span little wear have no slope: one set', () => {
    const laps = Array.from({length: 6}, (_, i) =>
      lap(i, 10 + i * 0.1, 100 + i),
    );
    expect(wearBands(laps)[0].empty).toBe('one-set');
  });

  it('splits 15 or more laps into three fuel bands, lowest fuel first', () => {
    const laps: WearLap[] = Array.from({length: 15}, (_, i) =>
      lap(i, (i % 5) * 4, 100 + (i % 5), 60 - i * 2),
    );
    const bands = wearBands(laps);
    expect(bands).toHaveLength(3);
    expect(bands.map(b => b.laps.length)).toEqual([5, 5, 5]);
    expect(bands[0].laps[0].fuelStartL).toBe(32);
    expect(bands[0].label).toBe('Fuel at start 32–40 L');
    expect(bands[2].laps.every(l => l.fuelStartL >= 50)).toBe(true);
  });
});

describe('jointFit', () => {
  // Two stints: wear and fuel move together inside each, but the second stint
  // starts on older tyres (carried across a stop), so they are not locked.
  const TRUE_B = 0.05;
  const TRUE_C = 0.03;
  const laps = [
    ...Array.from({length: 10}, (_, i) => [i, 60 - 3 * i]),
    ...Array.from({length: 10}, (_, i) => [14 + i, 60 - 3 * i]),
  ].map(([x, f], i) => lap(i, x, 90 + TRUE_B * x + TRUE_C * f, f));

  it('recovers the wear and fuel effects where one-variable fits do not', () => {
    const fit = jointFit(laps);
    if (fit.kind !== 'fit') throw new Error('no fit');
    expect(fit.corr).toBeLessThan(0);
    expect(Math.abs(fit.corr)).toBeLessThan(0.9);
    expect(fit.sPerPct).toBeCloseTo(TRUE_B, 6);
    expect(fit.sPerL).toBeCloseTo(TRUE_C, 6);
    // Wear alone, with fuel left in, misses the wear effect.
    const naive = leastSquares(laps.map(l => ({x: l.lostPct, y: l.timeS})));
    expect(Math.abs((naive?.slope ?? 0) - TRUE_B)).toBeGreaterThan(0.01);
  });

  it('has no number when wear and fuel are locked together, one stint', () => {
    const one = Array.from({length: 12}, (_, i) =>
      lap(i, i, 90 + TRUE_B * i + TRUE_C * (60 - 3 * i), 60 - 3 * i),
    );
    const fit = jointFit(one);
    expect(fit.kind).toBe('none');
    if (fit.kind === 'none') {
      expect(fit.why).toBe('locked');
      expect(Math.abs(fit.corr ?? 0)).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('has no number under 5 laps or under 2 % of wear span', () => {
    expect(jointFit(laps.slice(0, 3))).toMatchObject({why: 'few-laps'});
    const flat = laps
      .slice(0, 8)
      .map(l => ({...l, lostPct: 4 + l.fuelStartL * 0.001}));
    expect(jointFit(flat)).toMatchObject({why: 'one-set'});
  });
});
