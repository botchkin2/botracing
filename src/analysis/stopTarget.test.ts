import {describe, expect, it} from '@jest/globals';

import {stopTargets, type StopTargetInput} from './stopTarget';

// A Hypercar at 5.02 % VE and 3.9 L a lap at p90, a 100 L fill limit.
const base: StopTargetInput = {
  sim: 'lmu',
  meter: 've',
  stintLaps: [19, 19, 12],
  lateFlag: false,
  p90: {fuelL: 3.9, vePct: 5.02},
  fillLimitL: 100,
  fullVePct: 100,
  arrive: [4, 3],
};

describe('stopTargets: the level he sets at each stop', () => {
  it('a middle stop that a full load cannot cover is full; the last is the laps to the flag, rounded up', () => {
    const [mid, last] = stopTargets(base);
    // 19 x 5.02 = 95.4 -> 96 %; 12 x 5.02 = 60.24 -> 61 %.
    expect(mid).toMatchObject({meter: 've', verb: 'set', value: 96, added: 92});
    expect(last).toMatchObject({value: 61, arrive: 3, added: 58});
    expect(last.fuelLimited).toBe(false);
    expect(stopTargets({...base, stintLaps: [19, 21, 12]})[0].value).toBe(100);
  });

  it('does not depend on what the car arrives with', () => {
    const a = stopTargets(base).map(t => t.value);
    const b = stopTargets({...base, arrive: [20, 30]}).map(t => t.value);
    expect(b).toEqual(a);
  });

  it('a timed race covers the lap a late flag can add, on the last stop only', () => {
    const [mid, last] = stopTargets({...base, lateFlag: true});
    expect(mid.value).toBe(96);
    // 13 x 5.02 = 65.26 -> 66 %.
    expect(last.value).toBe(66);
  });

  it('is sized from fuel when fuel runs out first, and says so', () => {
    // 12 laps at 6.2 L is 74.4 L: 75 % of the 100 L limit, over the 61 % of VE.
    const [, last] = stopTargets({...base, p90: {fuelL: 6.2, vePct: 5.02}});
    expect(last).toMatchObject({value: 75, fuelLimited: true});
  });

  it('a car that arrives above the level gets no fill', () => {
    const [, last] = stopTargets({...base, arrive: [4, 70]});
    expect(last).toMatchObject({value: 61, added: 0, noFill: true});
  });

  it('a fuel-only car (LMP2) sets litres the same way, within the fill limit', () => {
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
});
