import {describe, expect, it} from '@jest/globals';

import {type PitPlan, type PitStint} from './pitPlan';
import {stopPanels, type StopPanelInput} from './stopPanels';

const stint = (
  n: number,
  laps: number,
  left: {fuelL: number | null; vePct: number | null},
  dryAtP90 = false,
): PitStint => ({
  n,
  laps,
  tyreLaps: {onSet: laps, sinceStart: laps},
  fuelL: null,
  vePct: null,
  left,
  dryAtMedian: false,
  dryAtP90,
});

// Silverstone-like: 30 laps, one stop after L19, 5.02 % VE and 3.5 L a lap.
const pit = (after = 19, p90Max = 19, dry = false): PitPlan => ({
  formation: {fuelL: 1.4, vePct: 0},
  stops: [{stop: 1, after, min: 11, max: 19, p90Max, refuel: null, pitS: null}],
  stints: [
    stint(1, after, {fuelL: 8, vePct: 4.6}),
    stint(2, 30 - after, {fuelL: 30, vePct: 40}, dry),
  ],
  finishLaps: 30,
  finishDelta: 0,
  pit: null,
  moved: after !== 19,
});

const input: StopPanelInput = {
  sim: 'lmu',
  meter: 've',
  p90: {fuelL: 3.6, vePct: 5.21},
  loadL: 75,
  fullVePct: 100,
  stopRatio: 0.75,
  fuelRatio: 0.75,
  lateFlag: true,
  pitModel: {baseS: 25, refuelLPerS: 3.4},
};

describe('stopPanels', () => {
  it('names the stop, the level to set and how it gets there', () => {
    const [p] = stopPanels(pit(), input);
    // 11 laps + the late flag's at 5.21 % = 62.5, and the 1 % floor at the flag: 63.5 -> 64 %.
    expect(p).toMatchObject({
      stop: 1,
      after: 'after L19',
      value: 'Set VE 64 %',
      tags: [],
      dryAtP90: false,
    });
    // Arrives on 4.6 %, adds 59.4 %: 44.6 L at 3.4 L/s plus 25 s of lane.
    expect(p.line).toBe('arrive 5 % · +59 % · 38 s');
    expect(p.fill?.arrive).toBeCloseTo(0.046);
    expect(p.fill?.set).toBeCloseTo(0.64);
  });

  it('moves with the slider: an earlier stop leaves more laps, so a higher level', () => {
    const [p] = stopPanels(pit(17), {...input, pitModel: null});
    // 13 + 1 laps at 5.21 % and the floor: 73.9 -> 74 %.
    expect(p.value).toBe('Set VE 74 %');
    expect(p.line).toBe('arrive 5 % · +69 %');
  });

  it('a stop past its safe end at p90 takes the warning tone', () => {
    expect(stopPanels(pit(19, 17), input)[0].dryAtP90).toBe(true);
    expect(stopPanels(pit(19, 19, true), input)[0].dryAtP90).toBe(true);
  });

  it('says fuel-limited when fuel runs out first', () => {
    const [p] = stopPanels(pit(), {...input, p90: {fuelL: 4.6, vePct: 5.21}});
    // 12 laps x 4.6 L = 55.2 L, 8 L left, 0.75 L a %: 4.6 + 62.9 = 67.5 -> 68 %, over 64 % of VE.
    expect(p.value).toBe('Set VE 68 %');
    expect(p.tags).toEqual(['fuel-limited']);
  });

  it('with no stop measured it shows the VE level only and says so, with no litres or seconds', () => {
    const [p] = stopPanels(pit(), {...input, stopRatio: null});
    expect(p.value).toBe('Set VE 64 %');
    expect(p.tags).toEqual(['no stop measured']);
    expect(p.line).toBe('arrive 5 % · +59 %');
  });

  it('with no stop measured and fuel running out first it warns, and still shows the VE level and no litres', () => {
    const [p] = stopPanels(pit(), {...input, stopRatio: null, p90: {fuelL: 4.6, vePct: 5.21}});
    expect(p.value).toBe('Set VE 64 %');
    expect(p.tags).toEqual(['fuel-limited', 'no stop measured']);
    expect(p.line).toBe('arrive 5 % · +59 %');
  });

  it('a fuel-only car sets litres, no label; iRacing adds an amount', () => {
    const fuel = {
      ...input,
      meter: 'fuel' as const,
      p90: {fuelL: 3.6, vePct: null},
    };
    const [lmp2] = stopPanels(pit(), fuel);
    // 12 x 3.6 = 43.2 -> 44 L.
    expect(lmp2.value).toBe('Set fuel 44 L');
    expect(lmp2.tags).toEqual([]);
    const [ir] = stopPanels(pit(), {...fuel, sim: 'iracing'});
    // 43.2 L less the 8 L left: add 36 L.
    expect(ir.value).toBe('Add 36 L');
    expect(ir.fill).toBeNull();
  });
});
