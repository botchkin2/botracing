import {describe, expect, it} from '@jest/globals';

import {toLaps} from '@/src/data/sessions/adapters';
import {type Lap} from '@/src/data/sessions';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {buildPitReview} from './pitReview';

const lap = (lapIndex: number, over: Partial<Lap> = {}): Lap => ({
  ...toLaps([{...fixture.laps[0], newTyres: false}])[0],
  id: `l${lapIndex}`,
  lapIndex,
  timeS: 90,
  partial: false,
  fuel: null,
  pitStop: null,
  newTyres: false,
  ...over,
});

const stop = {
  atEntry: {fuelL: 12.9, vePct: 0},
  added: {fuelL: 50, vePct: 38},
  inPitS: 81,
  lapsLeftAtEntry: {fuel: 3.6, ve: 0},
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
// on L4, L5 on new tyres, L6 the last timed lap.
const race = [
  lap(1, {pitStop: {...stop, added: {fuelL: 4, vePct: 0}}}),
  lap(2),
  lap(3),
  lap(4, {pitStop: stop, pitIn: true}),
  lap(5, {pitOut: true, newTyres: true}),
  lap(6, {fuel: fuelEnd(13.1, 5)}),
];

describe('buildPitReview', () => {
  it('has no review outside a race, or without a stop', () => {
    expect(buildPitReview('P', race)).toBeNull();
    expect(buildPitReview('Q', race)).toBeNull();
    expect(buildPitReview('R', [lap(1), lap(2)])).toBeNull();
  });

  it('leaves out the service before the start', () => {
    const r = buildPitReview('R', race)!;
    expect(r.stops.map(s => s.title)).toEqual(['L4 · Stop 1 of 1']);
  });

  it('gives a stop its tank, laps, fill, lane time and tyres', () => {
    expect(buildPitReview('R', race)!.stops[0].lines).toEqual([
      'In the tank: 12.9 L · 0 % VE',
      '3.6 laps of fuel · 0.0 laps of VE at the median',
      'Added: +50.0 L · +38 % VE',
      'In the lane: 81 s',
      'Tyres changed',
    ]);
  });

  it('says tyres not changed when the next lap has no wear jump, and nothing when there is no next lap', () => {
    const next = race.map(l => (l.lapIndex === 5 ? {...l, newTyres: false} : l));
    expect(buildPitReview('R', next)!.stops[0].lines).toContain(
      'Tyres not changed',
    );
    const last = buildPitReview('R', race.slice(0, 4))!;
    expect(last.stops[0].lines.join()).not.toContain('Tyres');
  });

  it('reads a stop that added nothing as a drive-through', () => {
    const drive = race.map(l =>
      l.lapIndex === 4
        ? {...l, pitStop: {...stop, added: {fuelL: 0, vePct: 0}}}
        : l,
    );
    const lines = buildPitReview('R', drive)!.stops[0].lines;
    expect(lines).toContain('Drive-through: nothing added');
    expect(lines.join()).not.toContain('Added');
  });

  it('closes the balance at the end: in + added - used after = left', () => {
    const {end} = buildPitReview('R', race)!;
    expect(end?.title).toBe('End of L6');
    expect(end?.lines[0]).toBe(
      'Fuel: 12.9 L in + 50.0 L added at the last stop · 49.8 L used after · 13.1 L left (3.7 laps at the median)',
    );
    expect(end?.lines[1]).toBe(
      'VE: 0 % in + 38 % added at the last stop · 33 % used after · 5 % left (1.2 laps at the median)',
    );
  });

  it('rounds first, so the printed sum closes', () => {
    // Unrounded 0.5 + 37.5 - 4.5 = 33.5 would print 34; as printed it is
    // 1 + 38 - 5 = 34 with 38 and 5 shown, and litres 12.94 + 49.96 - 13.06.
    const laps = race.map(l =>
      l.lapIndex === 4
        ? {
            ...l,
            pitStop: {
              ...stop,
              atEntry: {fuelL: 12.94, vePct: 0.5},
              added: {fuelL: 49.96, vePct: 37.5},
            },
          }
        : l.lapIndex === 6
        ? {...l, fuel: fuelEnd(13.06, 4.5)}
        : l,
    );
    const {end} = buildPitReview('R', laps)!;
    // 12.9 + 50.0 - 13.1 = 49.8, and 1 + 38 - 5 = 34.
    expect(end?.lines[0]).toContain('49.8 L used after');
    expect(end?.lines[1]).toContain('34 % used after');
  });

  it('ends on the last timed lap, not a cool-down lap', () => {
    const cool = [
      ...race,
      lap(7, {timeS: null, partial: true, fuel: fuelEnd(3, 1)}),
    ];
    expect(buildPitReview('R', cool)!.end?.title).toBe('End of L6');
  });

  it('numbers several stops', () => {
    const two = [...race.slice(0, 5), lap(6, {pitStop: stop}), lap(7)];
    expect(buildPitReview('R', two)!.stops.map(s => s.title)).toEqual([
      'L4 · Stop 1 of 2',
      'L6 · Stop 2 of 2',
    ]);
  });
});

describe('on the Road Atlanta race', () => {
  it('is left out when the stored laps carry no stop', () => {
    expect(buildPitReview('R', toLaps(fixture.laps))).toBeNull();
  });
});
