import {describe, expect, it} from '@jest/globals';

import {type GreenLap, planRace, type PlanRules} from '@/src/analysis/fuelPlan';

import {buildPlanCards, lapName} from './planCards';

// The round 5 frame's example, with our own lap names: a 2 h race at 101.2 s a
// lap, 2.38 L and 3.5 % VE a lap, a 100 L / 100 % load and a formation lap.
const rules: PlanRules = {
  name: 'ELMS 2 h',
  lengthLaps: null,
  lengthMin: 120,
  fuelL: 100,
  vePct: 100,
  formationLap: true,
  mandatoryStops: 0,
};
const lap = (fuelL: number, vePct: number | null): GreenLap => ({
  fuelL,
  vePct,
  lapTimeS: 101.2,
  sessionId: 's',
});
const history = (withVe = true): GreenLap[] =>
  Array.from({length: 12}, () => lap(2.38, withVe ? 3.5 : null));

describe('lapName', () => {
  it('names racing lap n as the app does: L1 is the formation lap', () => {
    expect(lapName(0)).toBe('L1');
    expect(lapName(27)).toBe('L28');
  });
});

describe('buildPlanCards', () => {
  const cards = buildPlanCards(planRace(rules, history()), rules, false);

  it('the Race card: laps from the median lap time, the full-tank stops and the arithmetic', () => {
    expect(cards.race.laps).toBe(72);
    expect(cards.race.oneFewer).toBe(71);
    expect(cards.race.stops).toBe(2);
    expect(cards.race.stopAfter).toEqual(['L28', 'L56']);
    expect(cards.race.working).toBe(
      "At the median lap, 1:41.200: 7,200 s ÷ 101.2 s = 71.1, so 72 laps. The race ends after the leader's lap, which can make it 71.",
    );
  });

  it('the Per tank card: a bar per meter from its own median, p90 notch, the shorter one runs out first', () => {
    const [fuel, ve] = cards.tank.meters;
    expect(fuel.key).toBe('fuel');
    expect(fuel.lapsMedian).toBeCloseTo(42.0, 1);
    expect(fuel.formula).toBe('100 L ÷ 2.38 L/lap');
    expect(ve.key).toBe('ve');
    expect(ve.lapsMedian).toBeCloseTo(28.6, 1);
    expect(ve.formula).toBe('100 % ÷ 3.50 %/lap');
    expect(ve.runsOutFirst).toBe(true);
    expect(fuel.runsOutFirst).toBe(false);
  });

  it('the Stops card: full tank first with its stint laps, VE per stint and the litres each stop refuels', () => {
    const full = cards.stops.full!;
    expect(full.stopAfter).toEqual(['L28', 'L56']);
    expect(full.stintLaps).toEqual([27, 28, 17]);
    // The first stint also burns the formation lap: (27 + 1) x 3.5 = 98.
    expect(full.vePerStint.map(Math.round)).toEqual([98, 98, 60]);
    // Two stops. Stop 1 refills what stint 1 (27 + formation) used. Stop 2
    // would refill 28 laps' worth, but the last stint is 17 laps, so it adds
    // only what those 17 need (17 x 2.38 = 40.5 L): enough to finish.
    expect(
      full.refuel.map(r => [Math.round(r.litres * 10) / 10, r.toFinish]),
    ).toEqual([
      [66.6, false],
      [40.5, true],
    ]);
  });

  it('the Stops card: equal stints second, over the same race', () => {
    const equal = cards.stops.equal!;
    expect(equal.kind).toBe('equal');
    expect(equal.stintLaps).toEqual([24, 24, 24]);
    expect(equal.stopAfter).toEqual(['L25', 'L49']);
    expect(equal.stintLaps.reduce((a, b) => a + b, 0)).toBe(72);
  });
});

describe('the fuel-only plan', () => {
  const plan = planRace(rules, history(false));
  const cards = buildPlanCards(plan, rules, true);

  it('has one meter and no "runs out first"', () => {
    expect(cards.tank.meters.map(m => m.key)).toEqual(['fuel']);
    expect(cards.tank.meters[0].runsOutFirst).toBe(false);
  });

  it('has no VE per stint, and stints set by fuel', () => {
    expect(cards.stops.full!.vePerStint).toEqual([]);
    // Fuel alone: (100 - 2.38) / 2.38 = 41 laps in the first stint.
    expect(cards.stops.full!.stintLaps[0]).toBe(41);
    expect(cards.stops.full!.stopAfter).toEqual(['L42']);
  });

  it('drops the VE meter even when VE numbers exist, if the plan is fuel-only by the data', () => {
    const forced = buildPlanCards(planRace(rules, history()), rules, true);
    expect(forced.tank.meters.map(m => m.key)).toEqual(['fuel']);
    expect(forced.stops.full!.vePerStint).toEqual([]);
  });
});

describe('a race that needs no stop', () => {
  it('has no stops and no stop laps', () => {
    const short: PlanRules = {...rules, lengthMin: null, lengthLaps: 20};
    const cards = buildPlanCards(planRace(short, history()), short, false);
    expect(cards.race.stops).toBe(0);
    expect(cards.race.stopAfter).toEqual([]);
    expect(cards.race.working).toBeNull();
    expect(cards.stops.equal).toBeNull();
    expect(cards.stops.full!.stintLaps).toEqual([20]);
  });
});
