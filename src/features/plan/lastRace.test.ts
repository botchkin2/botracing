import {describe, expect, it} from '@jest/globals';

import type {RaceFacts} from '@/src/analysis/fuelPlan';

import {lastRaceOf} from './lastRace';

const facts: RaceFacts = {
  planKey: 't|c',
  startedAt: '2026-09-27T20:00:00Z',
  limitL: 100,
  startL: 100,
  raceLaps: 72,
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
