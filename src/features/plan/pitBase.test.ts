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

const lap = (lapIndex: number, pitStop: PitStop | null): Lap => ({
  ...base,
  id: `l${lapIndex}`,
  lapIndex,
  pitIn: pitStop != null,
  pitStop,
});

// Lap 1 is the first lap; the stops are on later laps.
const race = (stops: (PitStop | null)[]) => ({
  sessionType: 'R' as const,
  laps: [lap(1, null), ...stops.map((s, i) => lap(i + 2, s))],
});

describe('pitLaneBase', () => {
  it('is the median of lane time minus litres / 3.4 over stops with fuel and no tyres', () => {
    // 51 - 34/3.4 = 41; 60 - 51/3.4 = 45.
    const b = pitLaneBase(
      [race([stop(51, 34, false), stop(60, 51, false)])],
      'GT3',
    );
    expect(b).toEqual({baseS: 43, stops: 2});
  });

  it('leaves out a tyre change, an unknown tyre state, no fuel and no lane time', () => {
    const b = pitLaneBase(
      [
        race([
          stop(51, 34, false),
          stop(60, 51, false),
          stop(70, 34, true),
          stop(70, 34, null),
          stop(30, 0, false),
          stop(null, 34, false),
        ]),
      ],
      'GT3',
    );
    expect(b?.stops).toBe(2);
  });

  it('is null under two stops, outside a race, and where the refuel rate is not measured', () => {
    expect(MIN_BASE_STOPS).toBe(2);
    expect(pitLaneBase([race([stop(51, 34, false)])], 'GT3')).toBeNull();
    const two = race([stop(51, 34, false), stop(60, 51, false)]);
    expect(pitLaneBase([{sessionType: 'P', laps: two.laps}], 'GT3')).toBeNull();
    expect(pitLaneBase([two], 'Hypercar')).toBeNull();
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
