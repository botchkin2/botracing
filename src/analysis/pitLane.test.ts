import {describe, expect, it} from '@jest/globals';

import {onPitLane, PIT_LANE_M} from './pitLane';

// A pit lane 300 m long, 30 m north of the racing line.
const lane = [
  [
    {x: 0, y: 30},
    {x: 150, y: 30},
    {x: 300, y: 30},
  ],
];

describe('onPitLane', () => {
  it('is true along the lane, including between its vertices and past its ends by the tolerance', () => {
    expect(onPitLane({x: 75, y: 30}, lane)).toBe(true);
    expect(onPitLane({x: 75, y: 30 + PIT_LANE_M}, lane)).toBe(true);
    expect(onPitLane({x: -PIT_LANE_M, y: 30}, lane)).toBe(true);
  });

  it('is false on the racing line or just beyond the tolerance', () => {
    expect(onPitLane({x: 75, y: 0}, lane)).toBe(false);
    expect(onPitLane({x: 75, y: 30 + PIT_LANE_M + 0.1}, lane)).toBe(false);
    expect(onPitLane({x: 300 + PIT_LANE_M + 1, y: 30}, lane)).toBe(false);
  });

  it('is false with no pit lane (a track with no reliable outline)', () => {
    expect(onPitLane({x: 75, y: 30}, [])).toBe(false);
    expect(onPitLane({x: 75, y: 30}, [[{x: 75, y: 30}]])).toBe(false);
  });

  it('handles a lane in several pieces and a zero-length segment', () => {
    const pieces = [
      [
        {x: 0, y: 0},
        {x: 0, y: 0},
      ],
      [
        {x: 100, y: 100},
        {x: 200, y: 100},
      ],
    ];
    expect(onPitLane({x: 1, y: 1}, pieces)).toBe(true);
    expect(onPitLane({x: 150, y: 103}, pieces)).toBe(true);
    expect(onPitLane({x: 50, y: 50}, pieces)).toBe(false);
  });
});
