import {describe, expect, it} from '@jest/globals';

import {type GreenLap, planRace, type PlanRules} from '@/src/analysis/fuelPlan';

import {pitPlan} from './pitPlan';
import {buildPlanCards} from './planCards';
import {TUE_RACE, WED_RACE} from './sebringRaces.fixture';
import {dropTarget, savingFor} from './saving';
import {rulesCells} from './model';
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
    fuelRatio: stopRatio,
    lateFlag: p.plan.raceLaps?.oneMore != null,
    pitModel: {baseS: 0, refuelLPerS: 1},
  })[0];

describe('the Wed rules with no load known (a practice only, thread 104)', () => {
  it('VE alone: the stop is still after L17, the limit reads VE limits, never together, and no fuel flag', () => {
    const laps = lapsOf(WED_RACE);
    // no load known: no fuel meter at all
    const rules: PlanRules = {
      name: 'rules',
      lengthLaps: null,
      lengthMin: 60,
      fuelL: null,
      vePct: 100,
      formationLap: true,
      mandatoryStops: 0,
      formationFactor: {fuel: 1.19 / median(laps.map(l => l.fuelL)), ve: 0},
    };
    const plan = planRace(rules, laps, null, 0.625);
    const cards = buildPlanCards(plan, rules, false, 0.625, 've', null);
    expect(cards.race.stopAfter).toEqual(['L17']);
    expect(cards.tank.limit).toMatch(/^VE limits: 17\.5 laps/);
    expect(cards.tank.meters.map(m => m.key)).toEqual(['ve']);
    const pit = pitPlan({plan, rules, fuelOnly: false, ratioPerPctL: 0.625, pitModel: null, windows: cards.stops.windows}, null)!;
    const [panel] = stopPanels(pit, {
      sim: 'lmu',
      meter: 've',
      // no load: no fuel meter, so no fuel use either
      p90: {fuelL: plan.perLap.fuel?.p90 ?? null, vePct: plan.perLap.ve!.p90},
      loadL: null,
      fullVePct: 100,
      stopRatio: 0.609,
      fuelRatio: 0.609,
      lateFlag: plan.raceLaps?.oneMore != null,
      pitModel: null,
    });
    expect(plan.perLap.fuel).toBeNull();
    expect(panel.value).toBe('Set VE 83 %');
    expect(panel.tags).toEqual([]);
  });

  it('counts the pit time of the stops with no load, from VE and his stop ratio: the same laps as with the 73 L load (chief #7166)', () => {
    const laps = lapsOf(WED_RACE);
    const base = (fuelL: number | null, stopRatioL: number | null): PlanRules => ({
      name: 'rules',
      lengthLaps: null,
      lengthMin: 60,
      fuelL,
      vePct: 100,
      formationLap: true,
      mandatoryStops: 0,
      stopRatioL,
      formationFactor: {fuel: 1.19 / median(laps.map(l => l.fuelL)), ve: 0},
    });
    const pitModel = {baseS: 25, refuelLPerS: 3.39};
    const withLoad = planRace(base(73, 0.609), laps, pitModel, 0.625);
    const noLoad = planRace(base(null, 0.609), laps, pitModel, 0.625);
    expect(withLoad.raceLaps?.pit).not.toBeNull();
    expect(noLoad.raceLaps?.pit).not.toBeNull();
    expect(noLoad.raceLaps?.estimate).toBe(withLoad.raceLaps?.estimate);
    // the pit time is really counted: it takes a lap off the 30 of a plan with no pit model
    expect(planRace(base(null, 0.609), laps, null, 0.625).raceLaps?.estimate).toBe(30);
    expect(noLoad.raceLaps?.estimate).toBe(29);
    // without a stop ratio no litres are known, so the stop counts its lane time only
    const noRatio = planRace(base(null, null), laps, pitModel, 0.625);
    expect(noRatio.raceLaps?.pit).toBeNull();
    // the Set VE level is the same with and without the load
    const levelOf = (plan: typeof noLoad, rules: PlanRules, loadL: number | null) => {
      const cards = buildPlanCards(plan, rules, false, 0.625, 've', null);
      const pit = pitPlan({plan, rules, fuelOnly: false, ratioPerPctL: 0.625, pitModel, windows: cards.stops.windows}, null)!;
      return stopPanels(pit, {
        sim: 'lmu',
        meter: 've',
        p90: {fuelL: plan.perLap.fuel?.p90 ?? null, vePct: plan.perLap.ve!.p90},
        loadL,
        fullVePct: 100,
        stopRatio: 0.609,
        fuelRatio: 0.609,
        lateFlag: plan.raceLaps?.oneMore != null,
        pitModel,
      })[0].value;
    };
    expect(levelOf(noLoad, base(null, 0.609), null)).toBe(levelOf(withLoad, base(73, 0.609), 73));
  });

  it('nothing in litres is made up: no Max fuel cell, no fuel saving target, and the VE target stays (steward #7157, chief #7158)', () => {
    const laps = lapsOf(WED_RACE);
    const rules: PlanRules = {
      name: 'rules',
      lengthLaps: null,
      lengthMin: 60,
      fuelL: null,
      vePct: 100,
      formationLap: true,
      mandatoryStops: 0,
      formationFactor: {fuel: 1.19 / median(laps.map(l => l.fuelL)), ve: 0},
    };
    const plan = planRace(rules, laps, null, 0.625);
    const cells = rulesCells(rules, true);
    expect(cells.map(c => c.label)).not.toContain('Max fuel');
    expect(JSON.stringify(cells)).not.toMatch(/125|Infinity|NaN/);
    // one stop fewer would need under 100 / 30 = 3.3 % a lap against his 5.7
    expect(dropTarget(plan.dropStop, 'fuel')).toBeNull();
    expect(dropTarget(plan.dropStop, 've')).toBeCloseTo(3.3, 1);
    const cards = buildPlanCards(plan, rules, false, 0.625, 've', null);
    const pit = pitPlan({plan, rules, fuelOnly: false, ratioPerPctL: 0.625, pitModel: null, windows: cards.stops.windows}, null)!;
    expect(savingFor(pit, plan.dropStop, 'fuel', rules, laps)).toBeNull();
    // none of his laps used under 3.3 % VE, so there is no VE saving to show either
    expect(savingFor(pit, plan.dropStop, 've', rules, laps)).toBeNull();
    expect(JSON.stringify([cards, plan.dropStop])).not.toMatch(/Infinity|NaN/);
  });
});

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
    // 13 laps after the stop and the late-flag lap at the p90 use, and the 1 % floor at the flag
    const level = Math.ceil((13 + 1) * wed.plan.perLap.ve!.p90 + 1);
    expect(p.value).toBe(`Set VE ${level} %`);
    expect(level).toBe(83);
    // arrives on 3.1 % VE and 11.1 L: the litres are (83 - 3.1) x 0.609 = 48.7 L
    const arrive = wed.pit.stints[0].left;
    expect(arrive.fuelL).toBeCloseTo(11.12, 1);
    expect(p.line).toBe('arrive 3 % · +80 % · 49 s');
    // the old reading, the % of the load, would have put in 79 % x 73 L = 57.6 L
    expect(Math.round(((level - arrive.vePct!) * 73) / 100)).toBe(58);
    expect(p.tags).toEqual([]);
  });

  it('the Wed stop leaves at least 1 % VE at the flag at the p90 use (the floor, apex #7174)', () => {
    const level = Math.ceil((13 + 1) * wed.plan.perLap.ve!.p90 + 1);
    // arrives at the flag having burnt 14 laps at the p90 use from the level
    expect(level - 14 * wed.plan.perLap.ve!.p90).toBeGreaterThanOrEqual(1);
  });

  it('with his pit model (25 s + 3.39 L/s) the Wed plan is 29 laps and the stop reads Set VE 77 %, at least 1 % left at the flag', () => {
    const laps = lapsOf(WED_RACE);
    const rules: PlanRules = {
      name: 'rules',
      lengthLaps: null,
      lengthMin: 60,
      fuelL: 73,
      vePct: 100,
      formationLap: true,
      mandatoryStops: 0,
      stopRatioL: 0.609,
      formationFactor: {fuel: 1.19 / median(laps.map(l => l.fuelL)), ve: 0},
    };
    const pitModel = {baseS: 25, refuelLPerS: 3.39};
    const plan = planRace(rules, laps, pitModel, 0.625);
    expect(plan.raceLaps?.estimate).toBe(29);
    const cards = buildPlanCards(plan, rules, false, 0.625, 've', null);
    const pit = pitPlan({plan, rules, fuelOnly: false, ratioPerPctL: 0.625, pitModel, windows: cards.stops.windows}, null)!;
    const [panel] = stopPanels(pit, {
      sim: 'lmu',
      meter: 've',
      p90: {fuelL: plan.perLap.fuel!.p90, vePct: plan.perLap.ve!.p90},
      loadL: 73,
      fullVePct: 100,
      stopRatio: 0.609,
      fuelRatio: 0.609,
      lateFlag: plan.raceLaps?.oneMore != null,
      pitModel,
    });
    // 29 laps, the stop after L17: 12 laps after it plus the late-flag lap = 13 x 5.8 + 1 floor = 76.4 -> 77
    expect(pit.stops[0].after).toBe(17);
    expect(panel.value).toBe('Set VE 77 %');
    expect(77 - 13 * plan.perLap.ve!.p90).toBeGreaterThanOrEqual(1);
  });

  it('the fuel-limited flag on the Wed stop: fuel needs 68 % against VE 83 %, so it is not set', () => {
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
    expect(p.value).toBe(`Set VE ${Math.ceil(9 * tue.plan.perLap.ve!.p90 + 1)} %`);
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
    expect(p.line).toBe('arrive 3 % · +80 %');
  });
});
