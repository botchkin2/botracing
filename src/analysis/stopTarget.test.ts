import {describe, expect, it} from '@jest/globals';

import {stopTargets, type StopTargetInput} from './stopTarget';

// A car at 5 % VE and 4.0 L a lap at p90 (0.8 L a %), a stop that adds 0.8 L a %, a 80 L load.
const base: StopTargetInput = {
  sim: 'lmu',
  meter: 've',
  stintLaps: [19, 19, 12],
  lateFlag: false,
  p90: {fuelL: 4.0, vePct: 5.0},
  loadL: 80,
  fullVePct: 100,
  stopRatio: 0.8,
  arrive: [4, 3],
  arriveFuelL: [3.2, 2.4],
};

describe('stopTargets: the level he sets at each stop', () => {
  it('a middle stop that a full load cannot cover is full; the last is the laps to the flag, rounded up', () => {
    const [mid, last] = stopTargets(base);
    // 19 x 5 = 95 %; 12 x 5 = 60 % + the 1 % floor at the flag. The litres are the % added at the stop ratio.
    expect(mid).toMatchObject({meter: 've', verb: 'set', value: 95, added: 91});
    expect(mid.addedL).toBeCloseTo(72.8);
    expect(last).toMatchObject({value: 61, arrive: 3, added: 58, unmeasured: false});
    expect(last.fuelLimited).toBe(false);
    expect(stopTargets({...base, stintLaps: [19, 21, 12]})[0].value).toBe(100);
  });

  it('the litres a stop adds are the % added times what a % adds at his stops, not the load over 100', () => {
    // 0.609 L a % at the stops against a 73 L load: 73.6 % is 44.8 L, not 53.7 L.
    const [t] = stopTargets({
      ...base,
      stintLaps: [17, 13],
      p90: {fuelL: 3.6, vePct: 5.7},
      loadL: 73,
      stopRatio: 0.609,
      arrive: [4.4],
      arriveFuelL: [2.75],
    });
    // 13 laps: VE wants 74.1 + 1 = 75.1 %, the litres want 4.4 + (46.8 - 2.75) / 0.609 = 76.7 %
    expect(t.value).toBe(77);
    expect(t.fuelLimited).toBe(true);
    expect(t.addedL).toBeCloseTo((77 - 4.4) * 0.609);
  });

  it('a timed race covers the lap a late flag can add, on the last stop only', () => {
    const [mid, last] = stopTargets({...base, lateFlag: true});
    expect(mid.value).toBe(95);
    expect(last.value).toBe(66);
  });

  it('is sized from fuel when fuel runs out first, and says so', () => {
    // 12 laps at 5.0 L over the 2.4 L left, at 0.8 L a %: from 3 % up to 75 %, over the 60 % of VE.
    const [, last] = stopTargets({...base, p90: {fuelL: 5.0, vePct: 5.0}});
    expect(last).toMatchObject({value: 75, fuelLimited: true});
  });

  it('two ratios a hair apart are not a limiter: the level takes the higher, the stop is not called fuel-limited', () => {
    const [, last] = stopTargets({...base, stopRatio: 0.79});
    // fuel wants 60.7 %, VE 60 %: under one step of the pit menu
    expect(last).toMatchObject({value: 61, fuelLimited: false});
  });

  it('with no stop measured the level is VE only and the litres are not known, never fill / 100', () => {
    const [, last] = stopTargets({...base, stopRatio: null});
    expect(last).toMatchObject({value: 61, unmeasured: true, addedL: null, fuelLimited: false});
  });

  it('a car that arrives above the level gets no fill', () => {
    const [, last] = stopTargets({...base, arrive: [4, 70], arriveFuelL: [3.2, 56]});
    expect(last).toMatchObject({value: 61, added: 0, noFill: true});
  });

  it('a fuel-only car (LMP2) sets litres the same way, within the load', () => {
    const t = stopTargets({
      ...base,
      meter: 'fuel',
      p90: {fuelL: 3.9, vePct: null},
      arrive: [2.5, 1.8],
    });
    // 19 x 3.9 = 74.1 -> 75 L; 12 x 3.9 = 46.8 -> 47 L.
    expect(t.map(x => [x.verb, x.value])).toEqual([
      ['set', 75],
      ['set', 47],
    ]);
    expect(t[1].added).toBeCloseTo(45.2);
    expect(t[1].addedL).toBeCloseTo(45.2);
  });

  it('iRacing adds an amount: what the laps need less what is left', () => {
    const [, last] = stopTargets({
      ...base,
      sim: 'iracing',
      meter: 'fuel',
      p90: {fuelL: 3.9, vePct: null},
      arrive: [2.5, 6.8],
    });
    // 46.8 L needed, 6.8 L left: add 40 L.
    expect(last).toMatchObject({verb: 'add', value: 40, noFill: false});
  });

  it('has nothing to say without the meter p90 use, or without a stop', () => {
    expect(stopTargets({...base, p90: {fuelL: 3.9, vePct: null}})).toEqual([]);
    expect(stopTargets({...base, stintLaps: [30]})).toEqual([]);
  });

  describe('the VE floor at the flag', () => {
    it('the last stop leaves at least 1 % at the flag at the p90 use; a middle stop has none', () => {
      const [mid, last] = stopTargets(base);
      // 19 x 5 = 95 %: the middle stop has no floor; 12 x 5 = 60 % + 1 % = 61 %
      expect(mid.value).toBe(95);
      expect(last.value).toBe(61);
      // arrives at the flag with 61 - 12 x 5 = 1 % left
      expect(last.value - 12 * base.p90.vePct!).toBeGreaterThanOrEqual(1);
    });

    it('stacks on the late-flag lap, and the level never goes past a full load', () => {
      const [, late] = stopTargets({...base, lateFlag: true});
      // 13 x 5 + 1 = 66 %
      expect(late.value).toBe(66);
      const [capped] = stopTargets({...base, stintLaps: [19, 20, 12], p90: {fuelL: 4.0, vePct: 4.95}});
      // 20 x 4.95 = 99 % is not a last stop; use a last stop that needs 100 %
      expect(capped.value).toBeLessThanOrEqual(100);
      const [, full] = stopTargets({...base, stintLaps: [19, 19, 20], p90: {fuelL: 4.0, vePct: 5.0}});
      // 20 x 5 + 1 = 101: capped at 100
      expect(full.value).toBe(100);
    });
  });
});
