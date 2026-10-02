import {describe, expect, it} from '@jest/globals';

import {toLaps} from './adapters';
import type {Lap} from './adapters';

import fixture from '@/src/features/session/__fixtures__/roadAtlantaRace.json';
import {endingLap, raceFacts, racePitLaps} from './raceFacts';

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

describe('raceFacts start', () => {
  it('reads the VE the car started the race on from the first recorded lap', () => {
    const first = lap(1, {
      fuel: {...lap(1).fuel!, veStartPct: 87},
    });
    const facts = raceFacts(session(), 'k', [lap(2), first, lap(3)]);
    expect(facts?.startVePct).toBe(87);
    expect(facts?.startL).toBe(75);
  });
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
        visit: null,
        tyres: null,
      },
    }),
    lap(6),
    lap(7, {partial: true, reasons: ['partial']}),
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

  it('takes the last lap that was not cut short, even one the game left untimed (Le Mans 09-21)', () => {
    const untimedEnd = [
      ...laps.slice(0, 5),
      lap(6, {timeS: null, partial: true, reasons: ['untimed']}),
      lap(7, {timeS: null, partial: true, reasons: ['partial', 'untimed']}),
    ];
    expect(raceFacts(session(), 'k', untimedEnd)?.raceLaps).toBe(5);
    // The same lap the pit card ends on.
    expect(endingLap(untimedEnd)?.lapIndex).toBe(6);
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

describe('racePitLaps', () => {
  const stopOf = {
    atEntry: {fuelL: 12.9, vePct: 0},
    added: {fuelL: 50, vePct: 38},
    inPitS: 81,
    lapsLeftAtEntry: {fuel: 3.6, ve: 0},
    visit: null,
    tyres: null,
  };
  // L1 from the grid (with the service before the start), L2-L3 flying, a
  // stop on L4, L5 out, L6 the last whole lap.
  const race = [
    lap(1, {pitStop: {...stopOf, added: {fuelL: 4, vePct: 0}}, pitOut: true}),
    lap(2),
    lap(3),
    lap(4, {pitStop: stopOf, pitIn: true}),
    lap(5, {pitOut: true}),
    lap(6),
  ];

  it('has no stops outside a race', () => {
    expect(racePitLaps('P', race)).toEqual([]);
    expect(racePitLaps('Q', race)).toEqual([]);
    expect(racePitLaps('R', [lap(1), lap(2)])).toEqual([]);
  });

  it('leaves out the service before the start', () => {
    expect(racePitLaps('R', race).map(l => l.lapIndex)).toEqual([4]);
  });

  it('keeps a stop on the first lap when that lap ends in the pit lane', () => {
    // Road Atlanta 09-25: L1 is 267 s, ends in the lane, the FL is changed.
    const first = [
      lap(1, {pitStop: stopOf, pitIn: true}),
      lap(2, {pitOut: true}),
      lap(3),
    ];
    expect(racePitLaps('R', first).map(l => l.lapIndex)).toEqual([1]);
  });

  it('lists several stops in driving order', () => {
    const two = [
      ...race.slice(0, 5),
      lap(6, {pitStop: stopOf, pitIn: true}),
      lap(7),
    ];
    expect(racePitLaps('R', two).map(l => l.lapIndex)).toEqual([4, 6]);
  });

  it('finds none on the stored Road Atlanta laps, which carry no stop', () => {
    expect(racePitLaps('R', toLaps(fixture.laps))).toEqual([]);
  });
});

describe('endingLap', () => {
  it('is null when no lap has a fuel level', () => {
    expect(endingLap([lap(1, {fuel: null}), lap(2, {fuel: null})])).toBeNull();
  });
});
