import {describe, expect, it} from '@jest/globals';

import type {RaceFacts} from '@/src/analysis/fuelPlan';

import {lastRaceLine, lastRaceOf} from './lastRace';

const facts: RaceFacts = {
  planKey: 't|c',
  startedAt: '2026-09-27T20:00:00Z',
  limitL: 100,
  startL: 100,
  startVePct: 87,
  raceLaps: 72,
  race: null,
  ownUse: {fuelL: 2.4, vePct: 3.5},
  stops: [
    {lapIndex: 25, fuelL: 12.9, vePct: 4},
    {lapIndex: 49, fuelL: 10.1, vePct: 3},
  ],
  end: {lapIndex: 73, fuelL: 4.9, vePct: 3},
};

describe('lastRaceOf', () => {
  it('gives the stops and the end in the app’s lap names', () => {
    expect(lastRaceOf('s1', facts)).toEqual({
      sessionId: 's1',
      startedAt: '2026-09-27T20:00:00Z',
      raceLaps: 72,
      stops: [
        {lap: 'L25', fuelL: 12.9, vePct: 4},
        {lap: 'L49', fuelL: 10.1, vePct: 3},
      ],
      end: {lap: 'L73', fuelL: 4.9, vePct: 3},
      // What the car started the race with: offered to the Plan, not applied.
      start: {fuelL: 100, vePct: 87},
      leftEarly: false,
      playerLapsDone: null,
      classLeaderLapsDone: null,
    });
  });

  it('is null without facts (no race, or no whole lap to end on)', () => {
    expect(lastRaceOf('s1', null)).toBeNull();
  });

  it('keeps a race with no stop and no fuel level at the end', () => {
    const bare = lastRaceOf('s1', {...facts, stops: [], end: null})!;
    expect(bare.stops).toEqual([]);
    expect(bare.end).toBeNull();
  });
});

describe('lastRaceLine', () => {
  const race = lastRaceOf('s1', facts)!;

  it('reads the stops by their pit-in lap and what was left at the end, in the lap-table numbering', () => {
    expect(lastRaceLine(race)).toBe(
      '2 stops at L25, L49 · 4.9 L / 3 % VE left at the end of L73',
    );
  });

  it('reads a race with no stop, and a fuel-only end without VE', () => {
    const one = {...race, stops: [race.stops[0]]};
    expect(lastRaceLine(one)).toContain('1 stop at L25');
    expect(lastRaceLine({...race, stops: []})).toContain('no stop');
    const fuelOnly = {...race, end: {lap: 'L73', fuelL: 4.9, vePct: null}};
    expect(lastRaceLine(fuelOnly)).toBe(
      '2 stops at L25, L49 · 4.9 L left at the end of L73',
    );
  });

  it('leaves the end out when there is no fuel level', () => {
    expect(lastRaceLine({...race, end: null})).toBe('2 stops at L25, L49');
  });

  it('a DNF names the lap against the race that finished', () => {
    expect(
      lastRaceLine({
        ...race,
        leftEarly: true,
        playerLapsDone: 21,
        classLeaderLapsDone: 24,
      }),
    ).toBe(
      'DNF at L21 of 24 · 2 stops at L25, L49 · 4.9 L / 3 % VE left at the end of L73',
    );
  });
});
