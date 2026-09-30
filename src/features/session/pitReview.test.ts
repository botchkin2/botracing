import {describe, expect, it} from '@jest/globals';

import type {Lap} from '@/src/data/sessions';
import {toLaps} from '@/src/data/sessions/adapters';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {endingLap, racePitLaps, tyresText} from './pitReview';

const lap = (lapIndex: number, over: Partial<Lap> = {}): Lap => ({
  ...toLaps([{...fixture.laps[0], newTyres: false}])[0],
  id: `l${lapIndex}`,
  lapIndex,
  timeS: 90,
  partial: false,
  reasons: [],
  fuel: null,
  pitStop: null,
  pitIn: false,
  pitOut: false,
  newTyres: false,
  ...over,
});

const stop = {
  atEntry: {fuelL: 12.9, vePct: 0},
  added: {fuelL: 50, vePct: 38},
  inPitS: 81,
  lapsLeftAtEntry: {fuel: 3.6, ve: 0},
  tyres: null,
};
const fuelEnd = (endL: number, veEndPct: number) => ({
  startL: 0,
  endL,
  usedL: 0,
  addedL: 0,
  veStartPct: 0,
  veEndPct,
  veUsedPct: 0,
  veAddedPct: 0,
  lapsLeftFuel: 3.7,
  lapsLeftVe: 1.2,
  green: true,
});

// L1 from the grid (with the service before the start), L2-L3 flying, a stop
// on L4, L5 out, L6 the last whole lap.
const race = [
  lap(1, {pitStop: {...stop, added: {fuelL: 4, vePct: 0}}, pitOut: true}),
  lap(2),
  lap(3),
  lap(4, {pitStop: stop, pitIn: true}),
  lap(5, {pitOut: true}),
  lap(6, {fuel: fuelEnd(13.1, 5)}),
];

describe('racePitLaps', () => {
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
      lap(1, {pitStop: stop, pitIn: true}),
      lap(2, {pitOut: true}),
      lap(3, {fuel: fuelEnd(13.1, 5)}),
    ];
    expect(racePitLaps('R', first).map(l => l.lapIndex)).toEqual([1]);
  });

  it('lists several stops in driving order', () => {
    const two = [
      ...race.slice(0, 5),
      lap(6, {pitStop: stop, pitIn: true}),
      lap(7),
    ];
    expect(racePitLaps('R', two).map(l => l.lapIndex)).toEqual([4, 6]);
  });

  it('finds none on the stored Road Atlanta laps, which carry no stop', () => {
    expect(racePitLaps('R', toLaps(fixture.laps))).toEqual([]);
  });
});

describe('endingLap', () => {
  it('is the last whole lap, timed or not, and not a cut-short lap after it', () => {
    const cool = [
      ...race,
      lap(7, {
        timeS: null,
        partial: true,
        reasons: ['partial'],
        fuel: fuelEnd(3, 1),
      }),
    ];
    expect(endingLap(cool)?.lapIndex).toBe(6);
    // The game stops timing the last laps of a race (Sarthe 09-21: L21-L23),
    // and the app's `partial` also carries its "incomplete" flag on them, so
    // only the uploader's 'partial' reason marks a cut-short lap (#160).
    const untimed = [
      ...race.slice(0, 5),
      lap(6, {
        timeS: null,
        partial: true,
        reasons: ['untimed'],
        fuel: fuelEnd(2.6, 0),
      }),
      lap(7, {
        timeS: null,
        partial: true,
        reasons: ['partial', 'untimed'],
        fuel: fuelEnd(2.5, 0),
      }),
    ];
    expect(endingLap(untimed)?.lapIndex).toBe(6);
  });

  it('is null when no lap has a fuel level', () => {
    expect(endingLap([lap(1), lap(2)])).toBeNull();
  });
});

describe('tyresText', () => {
  const at = (...wheels: ('FL' | 'FR' | 'RL' | 'RR')[]) =>
    tyresText({changed: wheels.length > 0, wheels});
  it('names the wheels the way a driver would', () => {
    expect(at('FL', 'FR', 'RL', 'RR')).toBe('all four');
    expect(at('FL', 'FR')).toBe('fronts');
    expect(at('RL', 'RR')).toBe('rears');
    expect(at('FL', 'RL')).toBe('lefts');
    expect(at('FR', 'RR')).toBe('rights');
    expect(at('RL')).toBe('RL only');
    expect(at('FL', 'RR')).toBe('FL and RR');
    expect(at('FL', 'FR', 'RL')).toBe('FL, FR and RL');
    expect(at()).toBe('not changed');
  });
});
