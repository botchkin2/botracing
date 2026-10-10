import {describe, expect, it} from '@jest/globals';

import {type RaceClock} from '@/src/analysis/raceClock';

import {raceTimeFor, selectionFor} from './selectionClock';

const laps = [
  {id: 'a-001', lapNumber: 1},
  {id: 'a-002', lapNumber: 2},
  {id: 'a-old', lapNumber: null},
];

// One lap of 100 s per lap number, 1 m per second: time = 100 * lap + distance.
const clock: RaceClock = {
  playerAt: t => ({lapNumber: Math.floor(t / 100), distanceM: t % 100}),
  timeAtLapDistance: (lap, d) => (lap >= 0 && lap <= 3 ? lap * 100 + d : null),
};

const sel = (over: Partial<Parameters<typeof raceTimeFor>[0]> = {}) => ({
  laps: ['a-001', 'a-002'],
  hl: null,
  cursorM: 40,
  ...over,
});

describe('raceTimeFor', () => {
  it('uses the highlighted lap, else the picked Ref, else the best checked lap', () => {
    expect(raceTimeFor(sel({hl: 'a-002'}), laps, clock)).toBe(240);
    expect(raceTimeFor(sel({ref: 'a-002'}), laps, clock)).toBe(240);
    // The highlight wins over the Ref.
    expect(raceTimeFor(sel({ref: 'a-002', hl: 'a-001'}), laps, clock)).toBe(140);
  });

  it('with no Ref the best checked lap, wherever it sits in the list', () => {
    const timed = [
      {id: 'a-001', lapNumber: 1, timeS: 81.2},
      {id: 'a-002', lapNumber: 2, timeS: 80.4},
      {id: 'a-old', lapNumber: null, timeS: 70},
    ];
    // a-002 is faster: it is the lap whatever order the laps were checked in.
    expect(raceTimeFor(sel({laps: ['a-001', 'a-002']}), timed, clock)).toBe(240);
    expect(raceTimeFor(sel({laps: ['a-002', 'a-001']}), timed, clock)).toBe(240);
    // With no times at all, the lowest lap number, still not the list order.
    expect(raceTimeFor(sel({laps: ['a-002', 'a-001']}), laps, clock)).toBe(140);
  });

  it('is null without a cursor, an unknown lap, or a lap with no number', () => {
    expect(raceTimeFor(sel({cursorM: null}), laps, clock)).toBeNull();
    expect(raceTimeFor(sel({laps: ['nope']}), laps, clock)).toBeNull();
    expect(raceTimeFor(sel({laps: ['a-old']}), laps, clock)).toBeNull();
    expect(raceTimeFor(sel({laps: []}), laps, clock)).toBeNull();
  });

  it('is null when the player never drove that far', () => {
    const short: RaceClock = {...clock, timeAtLapDistance: () => null};
    expect(raceTimeFor(sel(), laps, short)).toBeNull();
  });
});

describe('selectionFor', () => {
  it('writes the rounded cursor and follows onto a selected lap', () => {
    expect(
      selectionFor({lapNumber: 2, distanceM: 1234.6}, sel({hl: 'a-001'}), laps),
    ).toEqual({hl: 'a-002', cursorM: 1235});
  });

  it('keeps the highlight when the lap is not selected or unknown', () => {
    expect(
      selectionFor({lapNumber: 7, distanceM: 10}, sel({hl: 'a-001'}), laps),
    ).toEqual({hl: 'a-001', cursorM: 10});
    // Lap 1 exists but only lap a-002 is selected: do not add it.
    expect(
      selectionFor({lapNumber: 1, distanceM: 10}, sel({laps: ['a-002']}), laps),
    ).toEqual({hl: null, cursorM: 10});
  });
});
