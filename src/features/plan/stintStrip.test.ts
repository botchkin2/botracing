import {describe, expect, it} from '@jest/globals';

import {planRace, type PlanRules} from '@/src/analysis/fuelPlan';

import {perLapStrip} from './perLapStrip';
import {type PitPlan, type PitStint} from './pitPlan';
import {stintStrip, stripLabel} from './stintStrip';
import {type StopPanel} from './stopPanels';

const stint = (n: number, laps: number, ve: number): PitStint => ({
  n,
  laps,
  tyreLaps: {onSet: laps, sinceStart: laps},
  fuelL: null,
  vePct: {median: laps * ve, p90: laps * (ve + 0.2)},
  left: {fuelL: null, vePct: null},
  dryAtMedian: false,
  dryAtP90: false,
});

const pit: PitPlan = {
  formation: {fuelL: 1.4, vePct: 0},
  stops: [
    {
      stop: 1,
      after: 19,
      min: 11,
      max: 19,
      p90Max: 19,
      refuel: null,
      pitS: null,
    },
  ],
  stints: [stint(1, 19, 5), stint(2, 11, 5)],
  finishLaps: 30,
  finishDelta: 0,
  pit: null,
  moved: false,
};
const panel = {value: 'Set VE 63 %'} as StopPanel;

describe('stintStrip', () => {
  it('is the formation, then each stint by its laps, sharing the bar by laps', () => {
    const cells = stintStrip(pit, [panel], 've');
    expect(cells.map(c => c.label)).toEqual(['Formation', 'L1–L19', 'L20–L30']);
    expect(cells[0].formation).toBe(true);
    expect(cells.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1);
    expect(cells[1].share / cells[2].share).toBeCloseTo(19 / 11);
  });

  it('opens a stint on its laps, use at p90 and the level set at its stop', () => {
    const [formation, first, last] = stintStrip(pit, [panel], 've');
    expect(formation.detail).toEqual(['0.0 %']);
    expect(first.detail).toEqual(['19 laps', '99 % at p90', 'Set VE 63 %']);
    expect(last.detail).toEqual(['11 laps', '57 % at p90']);
    expect(stripLabel(pit)).toBe('L1–L30');
  });

  it('has no formation cell without a formation lap', () => {
    const cells = stintStrip({...pit, formation: null}, [], 've');
    expect(cells.map(c => c.label)).toEqual(['L1–L19', 'L20–L30']);
  });
});

describe('perLapStrip', () => {
  const rules: PlanRules = {
    name: 't',
    lengthLaps: 30,
    lengthMin: null,
    fuelL: 75,
    vePct: 100,
    formationLap: true,
    mandatoryStops: 0,
  };
  const laps = Array.from({length: 10}, (_, i) => ({
    fuelL: 3.4 + (i % 2) * 0.1,
    vePct: 5 + (i % 2) * 0.1,
    lapTimeS: 121,
    sessionId: 's',
  }));

  it('leads with VE per lap, then its p90, the laps a tank and the litres a %', () => {
    const s = perLapStrip(planRace(rules, laps), rules, 've', 0.68)!;
    expect(s.label).toBe('VE');
    expect(s.value).toBe('5.05 %/lap');
    expect(s.detail).toMatch(/^p90 5\.\d\d · 19\.8 laps a tank · 0\.68 L\/%$/);
  });

  it('reads litres for a fuel-only car', () => {
    const s = perLapStrip(planRace(rules, laps), rules, 'fuel', null)!;
    expect(s.value).toBe('3.45 L/lap');
    expect(s.detail).toMatch(/laps a tank$/);
  });
});
