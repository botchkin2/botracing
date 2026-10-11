import {describe, expect, it} from '@jest/globals';

import type {Lap, PitStop} from '@/src/data/sessions';

import {lapFuelLines, limitingLaps, pitLine, stintFuelLine} from './fuelLines';

// Road Atlanta race 2026-09-26, the stop on lap 16 (thread 34).
const stop: PitStop = {
  atEntry: {fuelL: 33.31, vePct: 39.9},
  added: {fuelL: 41.72, vePct: 60.1},
  inPitS: 90.5,
  lapsLeftAtEntry: {fuel: 13.9, ve: 11.1},
  visit: null,
  tyres: null,
};

describe('pitLine', () => {
  it('says what was left at entry in laps of the tighter budget, and what was added', () => {
    expect(pitLine(stop)).toBe(
      'Pit: 33.3 L / 40 % VE left (11.1 laps · VE) · +41.7 L · 91 s',
    );
  });

  it('a stop with nothing added reads +0.0 L, as long as a real refuel so it fits the row', () => {
    expect(pitLine({...stop, added: {fuelL: 0, vePct: 0}})).toBe(
      'Pit: 33.3 L / 40 % VE left (11.1 laps · VE) · +0.0 L · 91 s',
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
        visit: null,
      }),
    ).toBe('Pit: 7.2 L left (0.9 laps) · +41.7 L · 91 s');
  });

  it('no fuel channels, no line', () => {
    expect(pitLine({...stop, atEntry: {fuelL: null, vePct: null}})).toBeNull();
  });
});

describe('limitingLaps', () => {
  it('names the meter that runs out first when both are shown; a tie reads fuel; one meter is not named; none is null', () => {
    expect(limitingLaps({fuel: 13.9, ve: 11.1})).toBe('11.1 laps · VE');
    expect(limitingLaps({fuel: 0.9, ve: 4})).toBe('0.9 laps · fuel');
    expect(limitingLaps({fuel: 5, ve: 5})).toBe('5.0 laps · fuel');
    expect(limitingLaps({fuel: null, ve: 3})).toBe('3.0 laps');
    expect(limitingLaps({fuel: 7.2, ve: null})).toBe('7.2 laps');
    expect(limitingLaps({fuel: null, ve: null})).toBeNull();
  });
});

describe('stintFuelLine', () => {
  const g = (
    usedL: number,
    veUsedPct: number | null,
    over: Partial<Lap> = {},
  ) =>
    ({
      comparable: true,
      timeS: 80,
      fuel: {usedL, veUsedPct, green: true},
      ...over,
    } as Lap);

  it('the median use over the stint green laps', () => {
    expect(
      stintFuelLine([g(2.4, 3.5), g(2.4, 3.6), g(2.5, 3.7), g(2.3, 3.6)]),
    ).toBe('Fuel 2.40 L/lap · VE 3.6 %/lap');
  });

  it('a slow green lap that is not comparable still counts: it burned fuel', () => {
    const laps = [
      g(2.4, 2.5),
      g(2.4, 2.5),
      g(2.4, 2.5),
      g(3.0, 3.0, {comparable: false}),
      g(3.0, 3.0, {comparable: false}),
    ];
    // The two slow laps move the median up, as in the stored stint medians.
    expect(stintFuelLine(laps)).toBe('Fuel 2.40 L/lap · VE 2.5 %/lap');
    expect(stintFuelLine([...laps, g(3.0, 3.0, {comparable: false})])).toBe(
      'Fuel 2.70 L/lap · VE 2.8 %/lap',
    );
  });

  it('rounds a median of 2.55 up to 2.6, the same on the fuel card', () => {
    expect(stintFuelLine([g(2.4, 2.5), g(2.4, 2.55), g(2.4, 2.6)])).toBe(
      'Fuel 2.40 L/lap · VE 2.6 %/lap',
    );
  });

  it('a lap that is not green is left out', () => {
    const notGreen = {
      comparable: true,
      timeS: 80,
      fuel: {usedL: 9, veUsedPct: 9, green: false},
    } as Lap;
    expect(
      stintFuelLine([g(2.4, 2.5), g(2.4, 2.5), g(2.4, 2.5), notGreen]),
    ).toBe('Fuel 2.40 L/lap · VE 2.5 %/lap');
  });

  it('under 3 such laps there is no line', () => {
    expect(stintFuelLine([g(2.4, 3.6), g(2.4, 3.6)])).toBeNull();
    expect(stintFuelLine([])).toBeNull();
  });

  it('fuel only, when VE is missing', () => {
    expect(stintFuelLine([g(3.4, null), g(3.4, null), g(3.4, null)])).toBe(
      'Fuel 3.40 L/lap',
    );
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
