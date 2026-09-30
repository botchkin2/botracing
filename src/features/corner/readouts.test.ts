import {describe, expect, it} from '@jest/globals';

import {readoutsAt} from './readouts';
import {type ZoomLine} from './model';

const ch = (pairs: [number, number][]) => ({
  distanceM: pairs.map(p => p[0]),
  values: pairs.map(p => p[1]),
});

// A lap with its own recorded samples: speed every 10 m, lateral every 20 m.
function line(over: Partial<ZoomLine>): ZoomLine {
  return {
    lapId: 'a',
    label: 'L5',
    selIndex: 0,
    highlighted: false,
    onIndex: 0,
    key: true,
    speedKph: [],
    brakePct: [],
    throttlePct: [],
    deltaS: [0, 0.05, 0.1, 0.15, 0.2],
    steeringPct: [],
    samples: {
      speedKph: ch([
        [0, 100],
        [10, 110],
        [20, 120],
      ]),
      throttlePct: ch([[0, 100]]),
      brakePct: ch([[0, 0]]),
      steeringPct: ch([
        [0, -12.4],
        [20, 8],
      ]),
      gear: ch([[0, 3]]),
      pathLateralM: ch([
        [0, 3.41],
        [20, -2.2],
      ]),
      trackEdgeM: ch([[0, 5.75]]),
    },
    brakeAtM: null,
    fullThrottleAtM: null,
    ...over,
  } as ZoomLine;
}

describe('readoutsAt', () => {
  it('takes the nearest recorded sample, never an in-between value', () => {
    const r = readoutsAt([line({})], 5, 4);
    expect(r.speed[0].text).toBe('100');
    expect(r.steering[0].text).toBe('−12');
    expect(r.line[0].text).toBe('+3.4 m');
    expect(readoutsAt([line({})], 5, 12).speed[0].text).toBe('110');
    expect(readoutsAt([line({})], 5, 16).speed[0].text).toBe('120');
    expect(readoutsAt([line({})], 5, 16).line[0].text).toBe('−2.2 m');
  });

  it('reads the time difference on the grid, signed', () => {
    expect(readoutsAt([line({})], 5, 10).delta[0].text).toBe('+0.100');
  });

  it('is only for the laps that are on, reference first, in their colour order', () => {
    const lines = [
      line({lapId: 'b', label: 'L3', onIndex: 1}),
      line({lapId: 'c', label: 'L7', onIndex: null}),
      line({lapId: 'a', label: 'L5', onIndex: 0}),
    ];
    expect(readoutsAt(lines, 5, 0).speed.map(r => r.label)).toEqual([
      'L5',
      'L3',
    ]);
  });

  it('leaves out a channel a trace does not have (before analysis version 9)', () => {
    const old = line({
      samples: {
        ...line({}).samples,
        pathLateralM: {distanceM: [], values: []},
      },
    });
    const r = readoutsAt([old], 5, 10);
    expect(r.line).toEqual([]);
    expect(r.speed).toHaveLength(1);
  });
});
