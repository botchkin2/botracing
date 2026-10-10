import {describe, expect, it} from '@jest/globals';

import type {PlanStop} from '@/src/data/sessions';

import {MIN_BASE_STOPS, pitLaneBase, pitModelOf} from './pitBase';

// A race's stops as the uploader worked them out (tools/sessions/planBlock.mjs,
// whose tests hold the rules for `lossS`: fuel added, tyres known and not
// changed, a clean out-lap, a stint median). The app only turns each loss and
// its litres into a base.
const stop = (lossS: number | null, addedL: number | null): PlanStop => ({
  lapIndex: 5,
  fuelL: 10,
  vePct: 10,
  addedL,
  lossS,
});
const race = (...stops: PlanStop[]) => ({stops});

describe('pitLaneBase', () => {
  it('is the median of pit loss minus litres / 3.4 over the measured stops', () => {
    // Loss 60 - 34 / 3.4 = 50. Loss 51 - 51 / 3.4 = 36.
    const b = pitLaneBase(
      [race(stop(60, 34)), race(stop(51, 51))],
      'GT3',
    );
    expect(b).toEqual({baseS: 43, stops: 2});
  });

  it('pools the stops of every race, several to a race', () => {
    const b = pitLaneBase(
      [race(stop(60, 34), stop(60, 34)), race(stop(60, 34))],
      'GT3',
    );
    expect(b).toEqual({baseS: 50, stops: 3});
  });

  it('leaves out a stop with no loss (tyres changed or unknown, no out-lap) or no fuel added', () => {
    const b = pitLaneBase(
      [
        race(stop(60, 34), stop(60, 34)),
        race(stop(null, 34), stop(60, 0), stop(60, null)),
      ],
      'GT3',
    );
    expect(b?.stops).toBe(2);
  });

  it('is null under two stops, and where the refuel rate is not measured', () => {
    expect(MIN_BASE_STOPS).toBe(2);
    expect(pitLaneBase([race(stop(60, 34))], 'GT3')).toBeNull();
    expect(pitLaneBase([], 'GT3')).toBeNull();
    const two = [race(stop(60, 34), stop(60, 34))];
    expect(pitLaneBase(two, 'Hypercar')).toBeNull();
  });

  it('never goes below zero', () => {
    const b = pitLaneBase([race(stop(5, 34), stop(5, 34))], 'GT3');
    expect(b?.baseS).toBe(0);
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
