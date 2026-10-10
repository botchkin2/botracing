import {describe, expect, it} from '@jest/globals';

import {toLaps} from './adapters';
import type {Lap} from './adapters';

import fixture from '@/src/features/session/__fixtures__/roadAtlantaRace.json';
import type {PlanBlock} from './planBlock';
import {endingLap, raceFactsOfPlan, racePitLaps} from './raceFacts';

const base = toLaps([fixture.laps[0]])[0];
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

describe('raceFactsOfPlan', () => {
  // The race side as the uploader wrote it (tools/sessions/planBlock.mjs, whose
  // own tests hold the rules: the ending lap, the pre-start service, a first-lap
  // stop); here only that the app reads it as the facts the comparison wants.
  const plan = (race: PlanBlock['race']): PlanBlock => ({
    v: 1,
    fuel: {
      startL: 75,
      fillLimitL: 75,
      tankL: 105,
      litresPerVePct: null,
      litresPerVePctStop: null,
    },
    laps: null,
    race,
  });
  const race = {
    raceLaps: 20,
    minutes: 40,
    leftEarly: true,
    playerLapsDone: 21,
    classLeaderLapsDone: 21,
    startVePct: 87,
    formationL: 3.3,
    ownUse: {fuelL: 2.4, vePct: null},
    end: {lapIndex: 21, fuelL: 33.2, vePct: 32.2},
    stops: [{lapIndex: 9, fuelL: 12, vePct: 40, addedL: 50, lossS: 31}],
  };
  const when = '2026-09-26T00:38:00Z';

  it('gives the race side, the load and the start from the block', () => {
    expect(raceFactsOfPlan({startedAt: when, plan: plan(race)}, 'k')).toEqual({
      planKey: 'k',
      startedAt: when,
      limitL: 75,
      startL: 75,
      startVePct: 87,
      raceLaps: 20,
      race: {minutes: 40},
      leftEarly: true,
      playerLapsDone: 21,
      classLeaderLapsDone: 21,
      ownUse: {fuelL: 2.4, vePct: null},
      end: {lapIndex: 21, fuelL: 33.2, vePct: 32.2},
      stops: [{lapIndex: 9, fuelL: 12, vePct: 40}],
    });
  });

  it('has none outside a race, for a race with nothing to end on, and before the block existed', () => {
    expect(raceFactsOfPlan({startedAt: when, plan: plan(null)}, 'k')).toBeNull();
    expect(raceFactsOfPlan({startedAt: when, plan: null}, 'k')).toBeNull();
  });

  it('has no race length when the block has none (a race limited by laps)', () => {
    const facts = raceFactsOfPlan(
      {startedAt: when, plan: plan({...race, minutes: null})},
      'k',
    );
    expect(facts?.race).toBeNull();
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
