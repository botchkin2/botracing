import {describe, expect, it} from '@jest/globals';

import {laneGeometry, MIN_SPAN_PT} from './trafficLaneLayout';

const xOfM = (m: number) => m / 10; // a 1000 m window over 100 pt

describe('laneGeometry', () => {
  it('maps spans and ticks through the chart’s own x mapping', () => {
    const g = laneGeometry(
      {
        ahead: [[100, 300]],
        ticks: [
          {m: 500, kind: 'blue'},
          {m: 700, kind: 'pass'},
        ],
      },
      xOfM,
      100,
    );
    expect(g.spans).toEqual([{x: 10, w: 20}]);
    expect(g.ticks).toEqual([
      {x: 50, label: 'BLUE'},
      {x: 70, label: 'PASS'},
    ]);
  });

  it('clips at the edges, drops what is outside, and keeps a thin span visible', () => {
    const g = laneGeometry(
      {
        ahead: [
          [-500, 50], // starts before the window
          [2000, 3000], // after it
          [400, 400.5], // a thin run
        ],
        ticks: [{m: -10, kind: 'pass'}],
      },
      xOfM,
      100,
    );
    expect(g.spans).toEqual([
      {x: 0, w: 5},
      {x: 40, w: MIN_SPAN_PT},
    ]);
    expect(g.ticks).toEqual([]);
  });
});
