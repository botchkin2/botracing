import {describe, expect, it} from '@jest/globals';

import {toLaps} from '@/src/data/sessions/adapters';
import type {Lap, PitStop} from '@/src/data/sessions';

import fixture from '@/src/features/session/__fixtures__/roadAtlantaRace.json';

import {MIN_BASE_STOPS, pitLaneBase, pitModelOf} from './pitBase';

const base = toLaps([fixture.laps[0]])[0];

const stop = (
  inPitS: number | null,
  addedL: number,
  tyresChanged: boolean | null,
): PitStop => ({
  atEntry: {fuelL: 10, vePct: 10},
  added: {fuelL: addedL, vePct: 0},
  inPitS,
  lapsLeftAtEntry: {fuel: null, ve: null},
  tyres:
    tyresChanged === null
      ? null
      : {changed: tyresChanged, wheels: [], entryPct: null, exitPct: null},
});

const lap = (lapIndex: number, over: Partial<Lap> = {}): Lap => ({
  ...base,
  id: `l${lapIndex}`,
  lapIndex,
  timeS: 100,
  stint: 1,
  comparable: true,
  pitIn: false,
  pitOut: false,
  partial: false,
  pitStop: null,
  ...over,
});

// Four 100 s laps, an in-lap and an out-lap, then two more. Loss = in + out - 2 x 100.
const race = (inS: number, outS: number, pitStop: PitStop | null) => ({
  sessionType: 'R' as const,
  laps: [
    lap(1),
    lap(2),
    lap(3),
    lap(4),
    lap(5, {timeS: inS, pitIn: true, pitStop}),
    lap(6, {timeS: outS, pitOut: true, stint: 2}),
    lap(7, {stint: 2}),
  ],
});

describe('pitLaneBase', () => {
  it('is the median of pit loss minus litres / 3.4 over stops with fuel and no tyres', () => {
    // Loss 135 + 125 - 200 = 60; 60 - 34 / 3.4 = 50. Loss 126 + 125 - 200 = 51; 51 - 51 / 3.4 = 36.
    const b = pitLaneBase(
      [
        race(135, 125, stop(80, 34, false)),
        race(126, 125, stop(80, 51, false)),
      ],
      'GT3',
    );
    expect(b).toEqual({baseS: 43, stops: 2});
  });

  it('takes the loss, not the time in the lane', () => {
    const b = pitLaneBase(
      [
        race(135, 125, stop(999, 34, false)),
        race(135, 125, stop(1, 34, false)),
      ],
      'GT3',
    );
    expect(b?.baseS).toBe(50);
  });

  it('leaves out a tyre change, an unknown tyre state, no fuel and no out-lap', () => {
    const fuelled = stop(80, 34, false);
    const noOut = race(135, 125, fuelled);
    noOut.laps.splice(5, 2);
    const b = pitLaneBase(
      [
        race(135, 125, fuelled),
        race(135, 125, fuelled),
        race(135, 125, stop(80, 34, true)),
        race(135, 125, stop(80, 34, null)),
        race(135, 125, stop(30, 0, false)),
        noOut,
      ],
      'GT3',
    );
    expect(b?.stops).toBe(2);
  });

  it('leaves out a stop whose stint has under 3 green laps', () => {
    const short = race(135, 125, stop(80, 34, false));
    short.laps.splice(0, 3);
    expect(pitLaneBase([short, short], 'GT3')).toBeNull();
  });

  it('is null under two stops, outside a race, and where the refuel rate is not measured', () => {
    expect(MIN_BASE_STOPS).toBe(2);
    const one = race(135, 125, stop(80, 34, false));
    expect(pitLaneBase([one], 'GT3')).toBeNull();
    expect(pitLaneBase([one, one], 'Hypercar')).toBeNull();
    expect(
      pitLaneBase([{sessionType: 'P', laps: one.laps}, one], 'GT3'),
    ).toBeNull();
  });
});

describe('pitModelOf', () => {
  it('pairs the base with the refuel rate, and is null without a base', () => {
    expect(pitModelOf({baseS: 43, stops: 2})).toEqual({
      baseS: 43,
      refuelLPerS: 3.4,
    });
    expect(pitModelOf(null)).toBeNull();
  });
});
