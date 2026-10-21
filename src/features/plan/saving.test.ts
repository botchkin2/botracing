import {describe, expect, it} from '@jest/globals';

import {type GreenLap} from '@/src/analysis/fuelPlan';

import {bestStintMedian, MIN_STINT_LAPS, savingOf} from './saving';

const lap = (
  sessionId: string,
  lapIndex: number,
  vePct: number,
  lapTimeS = 121,
): GreenLap => ({fuelL: vePct * 0.7, vePct, lapTimeS, sessionId, lapIndex});

// A stint of `uses` in a row from lap `from` of session `s`.
const run = (s: string, from: number, uses: number[], t = 121) =>
  uses.map((u, i) => lap(s, from + i, u, t));

describe('bestStintMedian', () => {
  it('is the lowest median over runs of five or more green laps in a row', () => {
    const laps = [
      ...run('a', 2, [5.0, 5.1, 5.0, 5.2, 5.1]),
      // A stop (laps 7-8 not green) ends the stint; the second one saves.
      ...run('a', 9, [4.7, 4.8, 4.6, 4.7, 4.8, 4.7]),
    ];
    expect(bestStintMedian(laps, 've')).toBeCloseTo(4.7);
  });

  it('never takes single laps: four low laps in a row are no stint', () => {
    const laps = [
      ...run('a', 2, [5.0, 5.1, 5.0, 5.2, 5.1]),
      ...run('a', 9, [4.0, 4.0, 4.0, 4.0]),
    ];
    expect(MIN_STINT_LAPS).toBe(5);
    expect(bestStintMedian(laps, 've')).toBeCloseTo(5.1);
  });

  it('does not join laps of two sessions, and says none without a full stint', () => {
    const laps = [...run('a', 20, [4.5, 4.5, 4.5]), ...run('b', 1, [4.5, 4.5])];
    expect(bestStintMedian(laps, 've')).toBeNull();
  });
});

describe('savingOf', () => {
  const history = [
    ...run('a', 2, [5.0, 5.1, 5.0, 5.2, 5.1], 121.6),
    ...run('a', 9, [4.4, 4.5, 4.4, 4.5, 4.6, 4.4], 121.4),
  ];

  it('gives the target, his laps at or under it and his best stint, side by side', () => {
    const s = savingOf('ve', 4.47, history)!;
    expect(s.target).toBe(4.47);
    expect(s.atOrUnder).toEqual({n: 3, of: 11});
    expect(s.bestStint).toBeCloseTo(4.45);
    // Under MIN_COMPARE_LAPS laps at or under: no lap time quoted.
    expect(s.lapTimes).toBeNull();
  });

  it('quotes the lap times once five laps are at or under the target', () => {
    const s = savingOf('ve', 4.6, history)!;
    expect(s.atOrUnder.n).toBe(6);
    expect(s.lapTimes).toEqual({atOrUnderS: 121.4, allS: 121.4});
  });

  it('asks nothing without a target', () => {
    expect(savingOf('ve', null, history)).toBeNull();
  });
});
