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
  fillLimitL: 75,
  fullVePct: 100,
  lateFlag: true,
  pitModel: {baseS: 25, refuelLPerS: 3.4},
};

describe('stopPanels', () => {
  it('names the stop, the level to set and how it gets there', () => {
    const [p] = stopPanels(pit(), input);
    // 11 laps + the late flag's at 5.21 %: 62.5 -> 63 %.
    expect(p).toMatchObject({
      stop: 1,
      after: 'after L19',
      value: 'Set VE 63 %',
      tags: [],
      dryAtP90: false,
    });
    // Arrives on 4.6 %, adds 58.4 %: 43.8 L at 3.4 L/s plus 25 s of lane.
    expect(p.line).toBe('arrive 5 % · +58 % · 38 s');
    expect(p.fill?.arrive).toBeCloseTo(0.046);
    expect(p.fill?.set).toBeCloseTo(0.63);
  });

  it('moves with the slider: an earlier stop leaves more laps, so a higher level', () => {
    const [p] = stopPanels(pit(17), {...input, pitModel: null});
    // 13 + 1 laps at 5.21 %: 72.9 -> 73 %.
    expect(p.value).toBe('Set VE 73 %');
    expect(p.line).toBe('arrive 5 % · +68 %');
  });

  it('a stop past its safe end at p90 takes the warning tone', () => {
    expect(stopPanels(pit(19, 17), input)[0].dryAtP90).toBe(true);
    expect(stopPanels(pit(19, 19, true), input)[0].dryAtP90).toBe(true);
  });

  it('says fuel-limited when fuel runs out first', () => {
    const [p] = stopPanels(pit(), {...input, p90: {fuelL: 4.4, vePct: 5.21}});
    // 12 laps x 4.4 L = 52.8 L of 75 L: 71 % of the scale, over 63 % of VE.
    expect(p.value).toBe('Set VE 71 %');
    expect(p.tags).toEqual(['fuel-limited']);
  });

  it('a fuel-only car sets litres to fill to; iRacing adds an amount', () => {
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
