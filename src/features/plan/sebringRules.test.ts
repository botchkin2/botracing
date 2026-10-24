import {describe, expect, it} from '@jest/globals';

import {type GreenLap, planRace, type PlanRules} from '@/src/analysis/fuelPlan';

import {buildPlanCards} from './planCards';
import {pitPlan} from './pitPlan';
import {stopPanels} from './stopPanels';

// Two real 60 min GT3 races at one track, one week apart, numbers only (pit-wall
// thread 104, T1 and T2): the rules changed between them, 0.625 L a % on the
// Wednesday and 0.837 on the Tuesday, and the plan must follow the rules.
const lap = (fuelL: number, ratio: number, lapTimeS: number): GreenLap => ({
  fuelL,
  vePct: fuelL / ratio,
  lapTimeS,
  sessionId: 's',
  veMeasured: true,
});
const laps = (fuelL: number, ratio: number, lapTimeS: number) =>
  Array.from({length: 14}, () => lap(fuelL, ratio, lapTimeS));
const rulesOf = (fuelL: number): PlanRules => ({
  name: 'rules',
  lengthLaps: null,
  lengthMin: 60,
  fuelL,
  vePct: 100,
  formationLap: true,
  mandatoryStops: 0,
});

describe('the plan for his two real races at one track', () => {
  it('Wed rules (73 L, 0.625 L a %, 3.57 L and 5.7 % a lap): VE runs out first, around L17, with one stop', () => {
    const rules = rulesOf(73);
    const plan = planRace(rules, laps(3.57, 0.625, 123.5), null, 0.625);
    const cards = buildPlanCards(plan, rules, false, 0.625, 've');
    expect(cards.tank.limit).toMatch(/^VE runs out first: 17\.5 laps/);
    expect(plan.atMedian.stops).toBe(1);
    expect(cards.race.stopAfter[0]).toMatch(/^L1[67]$/);
  });

  it('Tue rules (85 L, 0.837 L a %, 3.60 L and 4.3 % a lap): fuel and VE run out together at 23 laps', () => {
    const rules = rulesOf(85);
    const plan = planRace(rules, laps(3.6, 0.837, 123.5), null, 0.837);
    const cards = buildPlanCards(plan, rules, false, 0.837, 've');
    expect(cards.tank.limit).toBe('VE and fuel run out together: 23 laps.');
  });

  it('a 75 L preset on the Wed rules keeps its VE: the stop is still near L17', () => {
    const rules = rulesOf(75);
    const plan = planRace(rules, laps(3.57, 0.625, 123.5), null, 0.625);
    expect(plan.perLap.ve).not.toBeNull();
    const cards = buildPlanCards(plan, rules, false, 0.625, 've');
    expect(cards.tank.limit).toMatch(/^VE runs out first/);
    expect(cards.race.stopAfter[0]).toMatch(/^L1[67]$/);
  });

  it('the stop adds the litres of his own stops: 0.609 L a %, not the load over 100', () => {
    const rules = rulesOf(73);
    const plan = planRace(rules, laps(3.57, 0.625, 123.5), null, 0.625);
    const input = {
      plan,
      rules,
      fuelOnly: false,
      ratioPerPctL: 0.625,
      pitModel: null,
      windows: buildPlanCards(plan, rules, false, 0.625, 've').stops.windows,
    };
    const pit = pitPlan(input, null);
    expect(pit).not.toBeNull();
    const [panel] = stopPanels(pit!, {
      sim: 'lmu',
      meter: 've',
      p90: {fuelL: plan.perLap.fuel!.p90, vePct: plan.perLap.ve!.p90},
      loadL: 73,
      fullVePct: 100,
      stopRatio: 0.609,
      lateFlag: plan.raceLaps?.oneMore != null,
      pitModel: null,
    });
    expect(panel.tags).not.toContain('assumed fill-to');
    expect(panel.value).toMatch(/^Set VE \d+ %$/);
  });
});
