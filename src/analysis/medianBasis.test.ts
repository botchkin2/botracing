import {describe, expect, it} from '@jest/globals';

import {medianBasisOf} from './medianBasis';
import {type GridTrace, resampleTrace} from './resample';

// A lap at a constant speed over 1,000 m, on the grid (what the screens hold).
function trace(kph: number): GridTrace {
  const v = kph / 3.6;
  const n = Math.ceil(1000 / v / 0.1) + 1;
  const pct = Array.from({length: n}, (_, i) =>
    Math.min(1, (i * 0.1 * v) / 1000),
  );
  const same = (x: number) => pct.map(() => x);
  return resampleTrace(
    {
      lapDistPct: pct,
      speedKph: same(kph),
      throttlePct: same(100),
      brakePct: same(0),
      steeringPct: same(0),
      gear: same(4),
      lat: pct,
      lon: same(0),
    },
    1000,
    5,
    10,
  );
}

describe('medianBasisOf', () => {
  it('is undefined when no lap has a trace loaded', () => {
    expect(medianBasisOf([{id: 'a', timeS: 90}], new Map())).toBeUndefined();
    expect(medianBasisOf([], new Map())).toBeUndefined();
  });

  it('leaves out laps without a trace, and takes the median of the rest', () => {
    const traces = new Map([
      ['a', trace(150)],
      ['b', trace(180)],
      ['c', trace(240)],
    ]);
    const laps = [
      {id: 'a', timeS: 90},
      {id: 'b', timeS: 89},
      {id: 'c', timeS: 91},
      {id: 'x', timeS: 88}, // no trace: not in the median
    ];
    const m = medianBasisOf(laps, traces)!;
    expect(m.speedKph[100]).toBeCloseTo(180);
  });

  it('a null lap time drops the time weighting but still takes the median', () => {
    const traces = new Map([
      ['a', trace(150)],
      ['b', trace(180)],
      ['c', trace(240)],
    ]);
    const m = medianBasisOf(
      [
        {id: 'a', timeS: null},
        {id: 'b', timeS: 89},
        {id: 'c', timeS: 91},
      ],
      traces,
    )!;
    expect(m.speedKph[100]).toBeCloseTo(180);
  });
});
