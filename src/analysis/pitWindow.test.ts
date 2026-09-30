import {describe, expect, it} from '@jest/globals';

import {pitWindows} from './pitWindow';

describe('pitWindows', () => {
  it('one stop: earliest N - T, latest the first load', () => {
    // 50 laps, the first load goes 27, a full tank 28.
    expect(pitWindows(27, 28, 50, 1)).toEqual([
      {stop: 1, earliest: 22, latest: 27, withinLaps: null},
    ]);
  });

  it('two stops: each one given the others', () => {
    // 72 laps, loads of 27 then 28: stops at 27 and 55 at the latest.
    expect(pitWindows(27, 28, 72, 2)).toEqual([
      {stop: 1, earliest: 16, latest: 27, withinLaps: null},
      {stop: 2, earliest: 44, latest: 55, withinLaps: 28},
    ]);
  });

  it('has nothing without a stop', () => {
    expect(pitWindows(27, 28, 20, 0)).toEqual([]);
  });

  it('the stop after the first also has to come within a tank of the one before', () => {
    // Stop 1 at its earliest (16) leaves stop 2 no later than 16 + 28 = 44.
    const [first, second] = pitWindows(27, 28, 72, 2);
    expect(first.withinLaps).toBeNull();
    expect(second.withinLaps).toBe(28);
    expect(first.earliest + (second.withinLaps ?? 0)).toBe(44);
  });

  it('keeps a stop no later than the lap before the last', () => {
    // Loads of 10 over 25 laps, two stops: stop 2 cannot pass lap 24.
    expect(pitWindows(10, 10, 25, 2)).toEqual([
      {stop: 1, earliest: 5, latest: 10, withinLaps: null},
      {stop: 2, earliest: 15, latest: 20, withinLaps: 10},
    ]);
  });

  it('gives up rather than print an empty window', () => {
    expect(pitWindows(5, 5, 40, 2)).toEqual([]);
  });
});
