import {describe, expect, it} from '@jest/globals';

import {toLaps} from '@/src/data/sessions/adapters';
import type {Lap} from '@/src/data/sessions';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {raceFacts} from './raceFacts';

const base = toLaps([fixture.laps[0]])[0];
const session = (type: 'R' | 'P' = 'R') => ({
  sessionType: type,
  startedAt: '2026-09-26T00:38:00Z',
  fuel: {
    startL: 75,
    fillLimitL: 75,
    tankL: 75,
    litresPerVePct: null,
    litresPerVePctStop: null,
  },
});
const lap = (lapIndex: number, over: Partial<Lap> = {}): Lap => ({
  ...base,
  id: `l${lapIndex}`,
  lapIndex,
  partial: false,
  timeS: 90,
  pitStop: null,
  fuel: {
    startL: 0,
    endL: 60,
    usedL: 2.4,
    addedL: 0,
    veStartPct: 0,
    veEndPct: 0,
    veUsedPct: 3.5,
    veAddedPct: 0,
    lapsLeftFuel: null,
    lapsLeftVe: null,
    green: true,
  },
  ...over,
});

describe('raceFacts', () => {
  const laps = [
    lap(1),
    lap(2),
    lap(3),
    lap(4),
    lap(5, {
      pitStop: {
        atEntry: {fuelL: 12.9, vePct: 0},
        added: {fuelL: 50, vePct: 38},
        inPitS: 81,
        lapsLeftAtEntry: {fuel: 3.6, ve: 0},
      },
    }),
    lap(6),
    lap(7, {partial: true}),
  ];

  it('is only for a race', () => {
    expect(raceFacts(session('P'), 'k', laps)).toBeNull();
  });

  it('counts racing laps from the last whole lap, the formation lap not counted', () => {
    // Last whole lap is lapIndex 6, so 5 racing laps.
    expect(raceFacts(session(), 'k', laps)?.raceLaps).toBe(5);
  });

  it('gives each stop as its pit-in lap number, and the fuel left at entry', () => {
    expect(raceFacts(session(), 'k', laps)?.stops).toEqual([
      {lapIndex: 5, fuelL: 12.9, vePct: 0},
    ]);
  });

  it('takes the fill limit, the start fuel and the race’s own median use', () => {
    const f = raceFacts(session(), 'k', laps)!;
    expect(f.limitL).toBe(75);
    expect(f.startL).toBe(75);
    expect(f.ownUse.fuelL).toBeCloseTo(2.4, 2);
    expect(f.ownUse.vePct).toBeCloseTo(3.5, 2);
  });

  it('has no fill limit when the session has none, and no use under three laps', () => {
    const noLimit = {
      ...session(),
      fuel: {...session().fuel, fillLimitL: null},
    };
    expect(raceFacts(noLimit, 'k', laps)?.limitL).toBeNull();
    expect(
      raceFacts(session(), 'k', laps.slice(0, 2))?.ownUse.fuelL,
    ).toBeNull();
  });
});
