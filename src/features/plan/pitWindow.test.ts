import {describe, expect, it} from '@jest/globals';

import {pitWindows} from './pitWindow';

describe('pitWindows', () => {
  it('one stop: earliest N - T, latest the first load', () => {
    // 50 laps, the first load goes 27, a full tank 28.
    expect(pitWindows(27, 28, 50, 1)).toEqual([
      {stop: 1, earliest: 22, latest: 27},
    ]);
  });

  it('two stops: each one given the others', () => {
    // 72 laps, loads of 27 then 28: stops at 27 and 55 at the latest.
    expect(pitWindows(27, 28, 72, 2)).toEqual([
      {stop: 1, earliest: 16, latest: 27},
      {stop: 2, earliest: 44, latest: 55},
    ]);
  });

  it('has nothing without a stop', () => {
    expect(pitWindows(27, 28, 20, 0)).toEqual([]);
  });

  it('never puts a latest stop at or after the flag', () => {
    // A mandatory extra stop on a short race: stops cannot run past lap N - 1.
    expect(pitWindows(10, 10, 12, 2)).toEqual([
      {stop: 1, earliest: 1, latest: 10},
      {stop: 2, earliest: 2, latest: 11},
    ]);
  });

  it('gives up rather than print an empty window', () => {
    expect(pitWindows(5, 5, 40, 2)).toEqual([]);
  });
});
