import {describe, expect, it} from '@jest/globals';

import {toLaps} from '@/src/data/sessions/adapters';
import type {Lap, PitStop} from '@/src/data/sessions';
import type {PlanBlock} from '@/src/data/sessions/planBlock';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {stintTargets} from './stintTarget';

const base = toLaps([fixture.laps[0]])[0];

const stopAt = (
  vePct: number | null,
  fuelL: number | null,
  kind: 'service' | 'through' | null = 'service',
): PitStop => ({
  atEntry: {fuelL, vePct},
  added: {fuelL: 40, vePct: 50},
  inPitS: 30,
  lapsLeftAtEntry: {fuel: null, ve: null},
  tyres: null,
  visit: kind
    ? {kind, detail: null, did: ['refuel'], stationaryS: 20, evidence: []}
    : null,
});

/** A lap of a race: racing number `n`, with the levels it started and ended on. */
const lap = (
  n: number,
  stint: number,
  levels: {ve: [number, number]; l: [number, number]},
  over: Partial<Lap> = {},
): Lap => ({
  ...base,
  id: `l${n}`,
  lapIndex: n,
  lapNo: n,
  stint,
  pitIn: false,
  pitOut: false,
  pitStop: null,
  reasons: [],
  fuel: {
    startL: levels.l[0],
    endL: levels.l[1],
    usedL: levels.l[0] - levels.l[1],
    addedL: 0,
    veStartPct: levels.ve[0],
    veEndPct: levels.ve[1],
    veUsedPct: levels.ve[0] - levels.ve[1],
    veAddedPct: 0,
    lapsLeftFuel: null,
    lapsLeftVe: null,
    green: true,
  },
  ...over,
});

const noPlan = {plan: null};
const leftEarly = {plan: {race: {leftEarly: true}} as unknown as PlanBlock};

/**
 * Stint 1 of 4 laps ends in a stop with 12.4 % (8.2 L) left. Stint 2 opens on
 * the out lap, which starts before the refuel and ends on 40 % (30 L), then 4
 * laps to the flag, 0.2 % (0.1 L) left.
 */
const oneStop = (): Lap[] => [
  lap(1, 1, {ve: [100, 80], l: [75, 60]}),
  lap(2, 1, {ve: [80, 60], l: [60, 45]}),
  lap(3, 1, {ve: [60, 40], l: [45, 30]}),
  lap(
    4,
    1,
    {ve: [40, 12.4], l: [30, 8.2]},
    {
      pitIn: true,
      pitStop: stopAt(12.4, 8.2),
    },
  ),
  lap(5, 2, {ve: [12.4, 40], l: [8.2, 30]}, {pitOut: true}),
  lap(6, 2, {ve: [40, 30], l: [30, 22.5]}),
  lap(7, 2, {ve: [30, 20], l: [22.5, 15]}),
  lap(8, 2, {ve: [20, 10], l: [15, 7.5]}),
  lap(9, 2, {ve: [10, 0.2], l: [7.5, 0.1]}),
];

describe('stintTargets', () => {
  it('reads what was left at the stop, and the use a lap the last stint needed to reach the flag', () => {
    const t = stintTargets(noPlan, oneStop(), 've');
    expect(t.get(1)).toEqual({kind: 'stop', left: 12.4});
    // 40 % over the 4 laps after the out lap (Road Atlanta 09-25's shape: the out lap starts before the refuel).
    expect(t.get(2)).toEqual({kind: 'flag', needed: 10, atFlag: 0.2});
  });

  it('LMU holds the stop on one lap that is pit-in and pit-out, in the new stint: the stint before it ended, and the next one starts on the lap after', () => {
    // Sebring 10-21 (seat-test copy): the lap starts on 8.4 % and ends on 76.8 %; 4.4 % at the entry.
    const laps: Lap[] = [
      lap(1, 1, {ve: [100, 80], l: [75, 60]}),
      lap(2, 1, {ve: [80, 60], l: [60, 45]}),
      lap(3, 1, {ve: [60, 8.4], l: [45, 6]}),
      lap(
        4,
        2,
        {ve: [8.4, 40], l: [6, 30]},
        {
          pitIn: true,
          pitOut: true,
          pitStop: stopAt(4.4, 4),
        },
      ),
      lap(5, 2, {ve: [40, 30], l: [30, 22]}),
      lap(6, 2, {ve: [30, 20], l: [22, 15]}),
      lap(7, 2, {ve: [20, 10], l: [15, 7]}),
      lap(8, 2, {ve: [10, 0.5], l: [7, 0.2]}),
    ];
    const t = stintTargets(noPlan, laps, 've');
    expect(t.get(1)).toEqual({kind: 'stop', left: 4.4});
    expect(t.has(2) && t.get(2)).toEqual({
      kind: 'flag',
      needed: 10,
      atFlag: 0.5,
    });
  });

  it('counts litres for a car without VE', () => {
    const t = stintTargets(noPlan, oneStop(), 'fuel');
    expect(t.get(1)).toEqual({kind: 'stop', left: 8.2});
    expect(t.get(2)).toEqual({kind: 'flag', needed: 7.5, atFlag: 0.1});
  });

  it('a race with no stop has one stint to the flag', () => {
    const laps = oneStop().slice(5);
    const t = stintTargets(noPlan, laps, 've');
    expect([...t.keys()]).toEqual([2]);
    expect(t.get(2)).toEqual({kind: 'flag', needed: 10, atFlag: 0.2});
  });

  it('a race left early has no flag to reach, and still has its stop', () => {
    const t = stintTargets(leftEarly, oneStop(), 've');
    expect(t.get(1)?.kind).toBe('stop');
    expect(t.has(2)).toBe(false);
  });

  it('a drive-through is not a stop, and a stop with no level on record has none', () => {
    const through = oneStop();
    through[3] = {...through[3], pitStop: stopAt(12.4, 8.2, 'through')};
    expect(stintTargets(noPlan, through, 've').has(1)).toBe(false);
    const blank = oneStop();
    blank[3] = {...blank[3], pitStop: stopAt(null, 8.2)};
    expect(stintTargets(noPlan, blank, 've').has(1)).toBe(false);
    expect(stintTargets(noPlan, blank, 'fuel').has(1)).toBe(true);
  });

  it('a stop from an old session (visit unknown) still ends its stint', () => {
    const old = oneStop();
    old[3] = {...old[3], pitStop: stopAt(12.4, 8.2, null)};
    expect(stintTargets(noPlan, old, 've').get(1)).toEqual({
      kind: 'stop',
      left: 12.4,
    });
  });

  it('has no flag figure when the last stint carries no start level', () => {
    const laps = oneStop().map(l =>
      l.stint === 2 ? {...l, fuel: {...l.fuel!, veStartPct: null}} : l,
    );
    expect(stintTargets(noPlan, laps, 've').has(2)).toBe(false);
  });

  it('the service before the start is not a stop', () => {
    const laps = oneStop();
    laps[0] = {
      ...laps[0],
      lapNo: 1,
      pitIn: false,
      pitStop: stopAt(95, 70),
    };
    expect(stintTargets(noPlan, laps, 've').get(1)).toEqual({
      kind: 'stop',
      left: 12.4,
    });
  });
});
