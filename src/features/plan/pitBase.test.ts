import {describe, expect, it} from '@jest/globals';

import type {PlanStop} from '@/src/data/sessions';

import {refuelRateOf} from '@/src/analysis/refuel';

import {
  MIN_BASE_STOPS,
  pitLaneBase,
  pitModelOf,
  refuelRateFor,
} from './pitBase';

// A race's stops as the uploader worked them out (tools/sessions/planBlock.mjs,
// whose tests hold the rules for `lossS`: fuel added, tyres known and not
// changed, a clean out-lap, a stint median). The app only turns each loss and
// its litres into a base.
const stop = (
  lossS: number | null,
  addedL: number | null,
  over: Partial<PlanStop> = {},
): PlanStop => ({
  lapIndex: 5,
  fuelL: 10,
  vePct: 10,
  addedL,
  lossS,
  kind: 'service',
  detail: null,
  fillLPerS: null,
  ...over,
});
// The GT3 default, 3.4 L/s (no fill measured).
const GT3 = refuelRateOf([], 'GT3');
const race = (...stops: PlanStop[]) => ({stops});

describe('pitLaneBase', () => {
  it('is the median of pit loss minus litres / 3.4 over the measured stops', () => {
    // Loss 60 - 34 / 3.4 = 50. Loss 51 - 51 / 3.4 = 36.
    const b = pitLaneBase([race(stop(60, 34)), race(stop(51, 51))], GT3);
    expect(b).toEqual({baseS: 43, stops: 2});
  });

  it('pools the stops of every race, several to a race', () => {
    const b = pitLaneBase(
      [race(stop(60, 34), stop(60, 34)), race(stop(60, 34))],
      GT3,
    );
    expect(b).toEqual({baseS: 50, stops: 3});
  });

  it('leaves out a stop with no loss (tyres changed or unknown, no out-lap) or no fuel added', () => {
    const b = pitLaneBase(
      [
        race(stop(60, 34), stop(60, 34)),
        race(stop(null, 34), stop(60, 0), stop(60, null)),
      ],
      GT3,
    );
    expect(b?.stops).toBe(2);
  });

  it('is null under two stops, and where the refuel rate is not measured', () => {
    expect(MIN_BASE_STOPS).toBe(2);
    expect(pitLaneBase([race(stop(60, 34))], GT3)).toBeNull();
    expect(pitLaneBase([], GT3)).toBeNull();
    const two = [race(stop(60, 34), stop(60, 34))];
    expect(pitLaneBase(two, refuelRateOf([], 'Hypercar'))).toBeNull();
  });

  it('learns from services only: a repair or a penalty that kept a loss is left out', () => {
    const b = pitLaneBase(
      [
        race(stop(60, 34), stop(60, 34)),
        race(stop(120, 4, {kind: 'repair'}), stop(45, 0, {kind: 'penalty'})),
      ],
      GT3,
    );
    expect(b).toEqual({baseS: 50, stops: 2});
  });

  it('a block from before the kind was stored is left out: its stand-still may be a repair', () => {
    const none = pitLaneBase(
      [race(stop(60, 34, {kind: null}), stop(60, 34, {kind: null}))],
      GT3,
    );
    expect(none).toBeNull();
    // Beside services it neither counts nor moves the median.
    const b = pitLaneBase(
      [race(stop(60, 34), stop(60, 34), stop(200, 34, {kind: null}))],
      GT3,
    );
    expect(b).toEqual({baseS: 50, stops: 2});
  });

  it('uses the measured rate: 34 L at 1.7 L/s is 20 s, not 10', () => {
    const slow = refuelRateOf([1.7], 'GT3');
    const b = pitLaneBase([race(stop(60, 34), stop(60, 34))], slow);
    expect(b?.baseS).toBe(40);
  });

  it('never goes below zero', () => {
    const b = pitLaneBase([race(stop(5, 34), stop(5, 34))], GT3);
    expect(b?.baseS).toBe(0);
  });
});

describe('pitModelOf', () => {
  it('pairs the base with the refuel rate, and is null without either', () => {
    expect(pitModelOf({baseS: 43, stops: 2}, GT3)).toEqual({
      baseS: 43,
      refuelLPerS: 3.4,
    });
    expect(pitModelOf(null, GT3)).toBeNull();
    expect(pitModelOf({baseS: 43, stops: 2}, null)).toBeNull();
  });
});

describe('refuelRateFor', () => {
  it('is the median pump rate of every visit that added fuel, a repair included', () => {
    const r = refuelRateFor(
      [
        race(stop(60, 34, {fillLPerS: 3.4}), stop(null, 0)),
        race(stop(120, 4, {kind: 'repair', fillLPerS: 3.37})),
      ],
      'Hypercar',
    );
    expect(r).toEqual({lPerS: 3.385, stops: 2, measured: true});
  });

  it('falls back to the GT3 rate with no fill measured, and to none for another class', () => {
    expect(refuelRateFor([race(stop(60, 34))], 'GT3')).toEqual(GT3);
    expect(refuelRateFor([race(stop(60, 34))], 'LMP2')).toBeNull();
  });
});
