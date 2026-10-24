import {describe, expect, it} from '@jest/globals';

import {type GreenLap, planRace, type PlanRules} from '@/src/analysis/fuelPlan';

import {pitPlan} from './pitPlan';
import {buildPlanCards} from './planCards';
import {TUE_RACE, WED_RACE} from './sebringRaces.fixture';
import {stopPanels} from './stopPanels';

// His two real 60 min GT3 races at one track, a series week apart, numbers
// only (pit-wall thread 104, T1 and T2, chief's number check): the rules
// changed between them, 0.625 L a % on the Wednesday and 0.835 on the Tuesday,
// and the plan must follow the rules. The laps are the races' own 28 and 26.
const lapsOf = (l: [number, number, number][]): GreenLap[] =>
  l.map(([fuelL, vePct, lapTimeS]) => ({
    fuelL,
    vePct,
    lapTimeS,
    sessionId: 's',
    veMeasured: true,
  }));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function planFor(
  fixture: [number, number, number][],
  loadL: number,
  ratio: number,
  formationL: number,
) {
  const laps = lapsOf(fixture);
  const rules: PlanRules = {
    name: 'rules',
    lengthLaps: null,
    lengthMin: 60,
    fuelL: loadL,
    vePct: 100,
    formationLap: true,
    mandatoryStops: 0,
    formationFactor: {fuel: formationL / median(laps.map(l => l.fuelL)), ve: 0},
  };
  const plan = planRace(rules, laps, null, ratio);
  const cards = buildPlanCards(plan, rules, false, ratio, 've');
  const pit = pitPlan(
    {plan, rules, fuelOnly: false, ratioPerPctL: ratio, pitModel: null, windows: cards.stops.windows},
    null,
  );
  return {plan, rules, cards, pit: pit!};
}

// Litres put in = seconds at 1 L/s with no lane loss: the panel's line shows them
const panelOf = (
  p: ReturnType<typeof planFor>,
  loadL: number,
  stopRatio: number | null,
) =>
  stopPanels(p.pit, {
    sim: 'lmu',
    meter: 've',
    p90: {fuelL: p.plan.perLap.fuel!.p90, vePct: p.plan.perLap.ve!.p90},
    loadL,
    fullVePct: 100,
    stopRatio,
    lateFlag: p.plan.raceLaps?.oneMore != null,
    pitModel: {baseS: 0, refuelLPerS: 1},
  })[0];

describe('the plan for his two real races at one track', () => {
  const wed = planFor(WED_RACE, 73, 0.625, 1.19);
  const tue = planFor(TUE_RACE, 85, 0.835, 1.0);

  it('Wed rules (73 L, 0.625): 30 laps, one stop after exactly L17, VE runs out first', () => {
    expect(wed.cards.race.laps).toBe(30);
    expect(wed.plan.atMedian.stops).toBe(1);
    // he came in on L17: 100 % / 5.7 % = 17.5 laps of VE, and the formation burns none
    expect(wed.cards.race.stopAfter).toEqual(['L17']);
    expect(wed.cards.tank.limit).toBe('VE runs out first: 17.5 laps (100 % ÷ 5.70 %/lap).');
  });

  it('the Wed stop: the level from the VE need, the litres at 0.609 L a % (not the load over 100)', () => {
    const p = panelOf(wed, 73, 0.609);
    const level = Math.ceil((13 + 1) * wed.plan.perLap.ve!.p90);
    expect(p.value).toBe(`Set VE ${level} %`);
    expect(level).toBe(82);
    // arrives on 3.1 % VE and 11.1 L: the litres are (82 - 3.1) x 0.609 = 48 L
    const arrive = wed.pit.stints[0].left;
    expect(arrive.fuelL).toBeCloseTo(11.12, 1);
    expect(p.line).toBe('arrive 3 % · +79 % · 48 s');
    // the old reading, the % of the load, would have put in 79 % x 73 L = 57.6 L
    expect(Math.round(((level - arrive.vePct!) * 73) / 100)).toBe(58);
    expect(p.tags).toEqual([]);
  });

  it('the fuel-limited flag on the Wed stop: fuel needs 68 % against VE 82 %, so it is not set', () => {
    const arrive = wed.pit.stints[0].left;
    const fuelNeed =
      arrive.vePct! + (14 * wed.plan.perLap.fuel!.p90 - arrive.fuelL!) / 0.609;
    expect(Math.round(fuelNeed)).toBe(68);
    expect(panelOf(wed, 73, 0.609).tags).not.toContain('fuel-limited');
  });

  it('Tue rules (85 L, 0.835): fuel and VE run out together at 23 laps; the stop flag is not set either', () => {
    expect(tue.cards.tank.limit).toBe('VE and fuel run out together: 23 laps.');
    const p = panelOf(tue, 85, 0.823);
    expect(p.tags).toEqual([]);
    // 8 laps after the stop plus the late flag, at the p90 4.4 % VE
    expect(p.value).toBe(`Set VE ${Math.ceil(9 * tue.plan.perLap.ve!.p90)} %`);
  });

  it('a 75 L preset on the Wed rules keeps its VE and its stop near L17', () => {
    const p75 = planFor(WED_RACE, 75, 0.625, 1.19);
    expect(p75.plan.perLap.ve).not.toBeNull();
    expect(p75.cards.tank.limit).toMatch(/^VE runs out first/);
    expect(p75.cards.race.stopAfter).toEqual(['L17']);
  });

  it('with no stop measured the panel says so and shows no litres', () => {
    const p = panelOf(wed, 73, null);
    expect(p.tags).toEqual(['no stop measured']);
    expect(p.line).toBe('arrive 3 % · +79 %');
  });
});
