import {describe, expect, it} from '@jest/globals';

import {type GreenLap, planRace, type PlanRules} from '@/src/analysis/fuelPlan';

import {pitWindows} from '@/src/analysis/pitWindow';

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
// Litres of fuel one % of VE is worth here: 2.38 L / 3.5 %.
const RATIO = 0.68;
const history = (withVe = true): GreenLap[] =>
  Array.from({length: 12}, () => lap(2.38, withVe ? 3.5 : null));

describe('lapName', () => {
  it('names racing lap n as the app does: L1 is the formation lap', () => {
    expect(lapName(0)).toBe('L1');
    expect(lapName(27)).toBe('L28');
  });
});

describe('buildPlanCards', () => {
  const cards = buildPlanCards(planRace(rules, history()), rules, false, RATIO);

  it('the Race card: laps from the median lap time, the full-tank stops and the arithmetic', () => {
    expect(cards.race.laps).toBe(72);
    expect(cards.race.oneMore).toBe(73);
    expect(cards.race.stops).toBe(2);
    expect(cards.race.stopAfter).toEqual(['L28', 'L56']);
    expect(cards.race.working).toBe(
      'At the median lap, 1:41.200: 7,200 s ÷ 101.2 s = 71.1, so 72 laps. The flag can fall a lap later than your own pace says: 73 laps. Time in the pits is not counted.',
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
    // adds only what the last 17 laps need: VE is the limit here. Stint 2 used
    // 28 x 3.5 = 98 % VE, so 2 % is left, and 17 x 3.5 = 59.5 % needs 57.5 %
    // more, x 0.68 L per % = 39.1 L; the fuel need (17 x 2.38 = 40.46 L less
    // the 33.4 L still in the tank) is only 7.1 L, so VE wins. Capped at the
    // refill (66.6 L), and marked as enough to finish.
    expect(
      full.refuel.map(r => [Math.round(r.litres * 10) / 10, r.toFinish]),
    ).toEqual([
      [66.6, false],
      [39.1, true],
    ]);
  });

  it('with fuel as the only meter the last stop adds what the remaining laps need, not a full refill', () => {
    const fuelOnlyPlan = planRace(rules, history(false));
    const c = buildPlanCards(fuelOnlyPlan, rules, true);
    const full = c.stops.full!;
    // Fuel alone: 41 laps in the first stint (and the formation lap), then the
    // last 31: 31 x 2.38 = 73.7 L, less than the 99.96 L the first stint used
    // (the tank is nearly empty on arrival), so it adds 73.7 L, enough to
    // finish, not a full refill.
    expect(full.stintLaps).toEqual([41, 31]);
    expect(full.refuel).toEqual([
      // 31 x 2.38 = 73.78 L, less the 0.04 L still in the tank.
      {litres: expect.closeTo(31 * 2.38 - 0.04, 5), toFinish: true},
    ]);
  });

  it('a short last stint on fuel alone subtracts what is still in the tank', () => {
    const long: PlanRules = {...rules, lengthMin: null, lengthLaps: 50};
    const c = buildPlanCards(planRace(long, history(false)), long, true);
    const full = c.stops.full!;
    // Stint 1 is 41 laps, the last is 9: 9 x 2.38 = 21.4 L needed, and after
    // 42 x 2.38 = 100 L used the tank holds 0 L, so the need is the whole 21.4 L.
    expect(full.stintLaps).toEqual([41, 9]);
    expect(full.refuel[0].toFinish).toBe(true);
    expect(full.refuel[0].litres).toBeCloseTo(9 * 2.38, 1);
  });

  it('the Stops card: a pit window for each stop, at p90 use, with the median lap beside it', () => {
    // 72 laps (73 where the flag falls late: the windows use that), stints of 27
    // then 28 (formation lap off the first). Use does not vary here, so
    // p90 = median: the plan stop is the window's latest end.
    expect(cards.stops.windows).toEqual([
      {
        stop: 1,
        earliest: 17,
        latest: 27,
        planLap: 27,
        medianLap: 27,
        text: 'Stop 1: after L18 to L28 · 11 laps · at median use L28',
      },
      {
        stop: 2,
        earliest: 45,
        latest: 55,
        planLap: 55,
        medianLap: 55,
        text: 'Stop 2: after L46 to L56 · 11 laps · at median use L56, within 28 laps of stop 1',
      },
    ]);
    expect(cards.stops.windowNote).toBeNull();
  });

  it('a timed race: the windows use the late-flag length, so the earliest ends are a lap later than at the estimate', () => {
    const plan = planRace(rules, history());
    expect(plan.raceLaps?.estimate).toBe(72);
    expect(plan.raceLaps?.oneMore).toBe(73);
    const [first] = buildPlanCards(plan, rules, false, RATIO).stops.windows;
    const p90 = plan.atP90;
    const atEstimate = pitWindows(
      p90.firstStint.laps as number,
      p90.stint.laps as number,
      72,
      2,
    )[0];
    expect(first.earliest).toBe(atEstimate.earliest + 1);
    // A race counted in laps has no late flag: its length is the estimate.
    const lapsRace: PlanRules = {...rules, lengthMin: null, lengthLaps: 72};
    const fixed = planRace(lapsRace, history());
    expect(fixed.raceLaps?.oneMore ?? null).toBeNull();
    expect(
      buildPlanCards(fixed, lapsRace, false, RATIO).stops.windows[0].earliest,
    ).toBe(atEstimate.earliest);
  });

  it('a plan with no stop gets no window, even where the late flag would need one', () => {
    // 43.9 min is 27 laps: the first load goes 27, so no stop. At the late-flag
    // length, 28 laps, a stop would be needed; that is not a pit window to show.
    const short: PlanRules = {...rules, lengthMin: 43.9};
    const plan = planRace(short, history());
    expect(plan.raceLaps?.estimate).toBe(27);
    expect(plan.raceLaps?.oneMore).toBe(28);
    expect(plan.atMedian.stopLaps).toEqual([]);
    const {stops} = buildPlanCards(plan, short, false, RATIO);
    expect(stops.windows).toEqual([]);
    // It is the run-dry case, so the card says so, with the extra load of the
    // meter that limits (VE here: 3.5 % a lap against a 100 % load, fuel 2.38 L
    // against 100 L), from the late-flag row of loadToFinish over the estimate row's.
    const [est, late] = plan.loadToFinish as NonNullable<
      typeof plan.loadToFinish
    >;
    expect(late.atP90.limitedBy).toBe('ve');
    const more = (late.atP90.vePct as number) - (est.atP90.vePct as number);
    expect(more).toBeGreaterThan(0);
    expect(stops.windowNote).toBe(
      `If the flag falls late, one load does not reach: one stop, or start with ${more.toFixed(
        1,
      )} % VE more${late.atP90.fits ? '' : ' than the rules allow'}.`,
    );
  });

  it('a plan with no stop and a late flag that one load still reaches says nothing', () => {
    // 40 min is 24 laps; 25 at the late flag is still inside the 27-lap load.
    const short: PlanRules = {...rules, lengthMin: 40};
    const plan = planRace(short, history());
    expect(plan.raceLaps?.oneMore).toBe(
      (plan.raceLaps?.estimate as number) + 1,
    );
    const {stops} = buildPlanCards(plan, short, false, RATIO);
    expect(stops.windows).toEqual([]);
    expect(stops.windowNote).toBeNull();
  });

  it('a heavier p90 pulls the planned stop earlier than the median tick, never past the window', () => {
    // Four laps in twelve at 2.6 L: p90 use above the median.
    const heavier = [
      ...Array.from({length: 8}, () => lap(2.38, 3.5)),
      ...Array.from({length: 4}, () => lap(2.6, 3.8)),
    ];
    const plan = planRace(rules, heavier);
    expect(plan.atP90.stopLaps[0]).toBeLessThan(plan.atMedian.stopLaps[0]);
    const {windows} = buildPlanCards(plan, rules, false, RATIO).stops;
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      expect(w.planLap).toBe(plan.atP90.stopLaps[w.stop - 1]);
      expect(w.planLap).toBeLessThanOrEqual(w.latest);
      expect(w.planLap).toBeGreaterThanOrEqual(w.earliest);
      expect(w.medianLap).toBe(plan.atMedian.stopLaps[w.stop - 1] ?? null);
    }
    // The median tick is where the optimistic case runs out: past the plan stop.
    expect(windows[0].medianLap as number).toBeGreaterThan(windows[0].planLap);
  });

  it('says so when p90 use needs more stops than the median', () => {
    // A third of the laps at 3.6 L: p90 use is far above the median.
    const heavy = [
      ...Array.from({length: 8}, () => lap(2.38, 3.5)),
      ...Array.from({length: 4}, () => lap(3.6, 5.2)),
    ];
    const plan = planRace(rules, heavy);
    const extra = plan.atP90.stopLaps.length - plan.atMedian.stopLaps.length;
    expect(extra).toBeGreaterThan(0);
    const {stops} = buildPlanCards(plan, rules, false, RATIO);
    expect(stops.windows).toHaveLength(plan.atP90.stopLaps.length);
    expect(stops.windowNote).toBe(
      `${extra} more ${extra === 1 ? 'stop' : 'stops'} than at median use`,
    );
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
    expect(cards.stops.windows).toEqual([]);
    expect(cards.stops.full!.stintLaps).toEqual([20]);
  });
});
