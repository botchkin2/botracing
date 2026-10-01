import {describe, expect, it} from '@jest/globals';

import {laneRowOf} from './trafficLane';

const base = {
  aheadSpans: [] as [number, number, number][],
  overtakes: [] as {atM: number}[],
  passMarks: [] as {atM: number; made: boolean}[],
  fieldLapM: 5000,
};

describe('laneRowOf', () => {
  it('is null without a lap length to scale by, or without a map length', () => {
    expect(laneRowOf(null, 5000)).toBeNull();
    expect(laneRowOf({...base, fieldLapM: null}, 5000)).toBeNull();
    expect(laneRowOf(base, 0)).toBeNull();
  });

  it('scales field distance to the map: lap fraction times map length', () => {
    const row = laneRowOf(
      {
        ...base,
        aheadSpans: [[1000, 2000, 5]],
        overtakes: [{atM: 2500}],
        passMarks: [{atM: 500, made: true}],
      },
      5100,
    )!;
    expect(row.ahead).toEqual([[1020, 2040]]);
    expect(row.ticks).toEqual([
      {m: 510, kind: 'pass'},
      {m: 2550, kind: 'blue'},
    ]);
  });

  it('clips a span that runs over the line, and drops one that is off the lap', () => {
    const row = laneRowOf(
      {
        ...base,
        aheadSpans: [
          [-90, -80, 1], // the race-start roll, before the line
          [-30, 200, 2], // over the start line
          [4900, 5200, 2], // over the finish line
          [5300, 5400, 1], // next lap
        ],
      },
      5000,
    )!;
    expect(row.ahead).toEqual([
      [0, 200],
      [4900, 5000],
    ]);
  });
});
