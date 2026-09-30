import {describe, expect, it} from '@jest/globals';

import type {Lap, PitStop} from '@/src/data/sessions';

import {lapFuelLines, pitLine, stintFuelLine} from './fuelLines';

// Road Atlanta race 2026-09-26, the stop on lap 16 (thread 34).
const stop: PitStop = {
  atEntry: {fuelL: 33.31, vePct: 39.9},
  added: {fuelL: 41.72, vePct: 60.1},
  inPitS: 90.5,
  lapsLeftAtEntry: {fuel: 13.9, ve: 11.1},
};

describe('pitLine', () => {
  it('says what was left at entry in laps of the tighter budget, and what was added', () => {
    expect(pitLine(stop)).toBe(
      'Pit: 33.3 L / 40 % VE left (11.1 laps) · +41.7 L · 91 s',
    );
  });

  it('a stop with nothing added reads +0.0 L, short enough for the phone row', () => {
    expect(pitLine({...stop, added: {fuelL: 0, vePct: 0}})).toBe(
      'Pit: 33.3 L / 40 % VE left (11.1 laps) · +0.0 L · 91 s',
    );
  });

  it('without a stint median there are no laps, without VE there is no VE', () => {
    expect(pitLine({...stop, lapsLeftAtEntry: {fuel: null, ve: null}})).toBe(
      'Pit: 33.3 L / 40 % VE left · +41.7 L · 91 s',
    );
    expect(
      pitLine({
        ...stop,
        atEntry: {fuelL: 7.18, vePct: null},
        lapsLeftAtEntry: {fuel: 0.9, ve: null},
      }),
    ).toBe('Pit: 7.2 L left (0.9 laps) · +41.7 L · 91 s');
  });

  it('no fuel channels, no line', () => {
    expect(pitLine({...stop, atEntry: {fuelL: null, vePct: null}})).toBeNull();
  });
});

describe('stintFuelLine', () => {
  it('the median use per green lap and how many laps it comes from', () => {
    expect(
      stintFuelLine({medianFuelL: 2.4, medianVePct: 3.6, greenLaps: 15}),
    ).toBe('Fuel 2.40 L/lap · VE 3.6 %/lap (n = 15)');
  });

  it('under 3 green laps the uploader gives no median: no line', () => {
    expect(
      stintFuelLine({medianFuelL: null, medianVePct: null, greenLaps: 2}),
    ).toBeNull();
  });

  it('fuel only, when VE is missing', () => {
    expect(
      stintFuelLine({medianFuelL: 3.4, medianVePct: null, greenLaps: 18}),
    ).toBe('Fuel 3.40 L/lap (n = 18)');
  });
});

describe('lapFuelLines', () => {
  const lap = (over: Partial<Lap>) =>
    ({
      fuel: {
        startL: 35.45,
        endL: 33.29,
        usedL: 2.16,
        addedL: 0,
        veStartPct: 43.1,
        veEndPct: 39.9,
        veUsedPct: 3.2,
        veAddedPct: 0,
        lapsLeftFuel: 13.9,
        lapsLeftVe: 11.2,
        green: false,
      },
      pitStop: null,
      ...over,
    } as Lap);

  it('used, left and laps at the median, fuel then VE', () => {
    expect(lapFuelLines(lap({}))).toEqual([
      'Fuel 2.16 L used · 33.29 L left · 13.9 laps at the median',
      'VE 3.2 % used · 39.9 % left · 11.2 laps at the median',
    ]);
  });

  it('a lap with a stop adds its length and what it took on', () => {
    expect(lapFuelLines(lap({pitStop: stop})).at(-1)).toBe(
      'Stop 91 s in the pits · +41.7 L · +60.1 % VE',
    );
  });

  it('a stop still in progress or with an unknown VE is not hidden or made up', () => {
    const open = {...stop, inPitS: null, added: {fuelL: 41.72, vePct: null}};
    expect(lapFuelLines(lap({pitStop: open})).at(-1)).toBe(
      'Stop in the pits · +41.7 L',
    );
  });

  it('no channels, no lines', () => {
    expect(lapFuelLines(lap({fuel: null}))).toEqual([]);
  });
});
