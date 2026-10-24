import {describe, expect, it} from '@jest/globals';

import {refuelRateOf} from '@/src/analysis/refuel';

import {type GreenLap, planRace, type PlanRules} from '@/src/analysis/fuelPlan';

import {pitWindows} from '@/src/analysis/pitWindow';

import {buildPlanCards} from './planCards';

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
// The load of these rules, known: the planner reads it as a number or null (unknown).
const LOAD_L = 100;
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

describe('buildPlanCards', () => {
  const cards = buildPlanCards(planRace(rules, history()), rules, false, RATIO);

  it('the Race card: laps from the median lap time, the full-tank stops and the arithmetic', () => {
    expect(cards.race.laps).toBe(72);
    expect(cards.race.oneMore).toBe(73);
    expect(cards.race.stops).toBe(2);
    expect(cards.race.stopAfter).toEqual(['L28', 'L56']);
    expect(cards.race.working).toBe('median 1:41.200');
  });

  it('the Race card counts the pit time when a pit model is given, and says how', () => {
    const withPit = buildPlanCards(
      planRace(rules, history(), {baseS: 45, refuelLPerS: 3.4}),
      rules,
      false,
      RATIO,
    );
    expect(withPit.race.laps).toBe(71);
    expect(withPit.race.working).toBe(
      'median 1:41.200 · pit 111 s (2 × 45 s + 70 L at 3.4 L/s)',
    );
  });

  it('the Per tank card: one bar in one unit, VE first, from its own median and p90 notch', () => {
    const [ve] = cards.tank.meters;
    expect(cards.tank.meters).toHaveLength(1);
    expect(ve.key).toBe('ve');
    expect(ve.lapsMedian).toBeCloseTo(28.6, 1);
    expect(ve.formula).toBe('100 % ÷ 3.50 %/lap');
    // Fuel would reach 42 laps: VE is the limit, said in words.
    expect(cards.tank.limit).toBe('VE runs out first: 28.6 laps (100 % ÷ 3.50 %/lap).');
  });

  it('asking for fuel shows the fuel bar, and says VE runs out first because it does', () => {
    const asked = buildPlanCards(
      planRace(rules, history()),
      rules,
      false,
      RATIO,
      'fuel',
    );
    const [fuel] = asked.tank.meters;
    expect(fuel.key).toBe('fuel');
    expect(fuel.lapsMedian).toBeCloseTo(42.0, 1);
    expect(fuel.formula).toBe('100 L ÷ 2.38 L/lap');
    expect(asked.tank.limit).toBe(
      'VE runs out first: 28.6 laps (100 % ÷ 3.50 %/lap).',
    );
  });

  it('with VE shown, the limit names fuel where it is the shorter meter', () => {
    const heavy = Array.from({length: 12}, () => lap(4.2, 3.5));
    const c = buildPlanCards(planRace(rules, heavy), rules, false, RATIO, 've');
    expect(c.tank.meters[0].key).toBe('ve');
    expect(c.tank.limit).toBe(
      'Fuel runs out first: 23.8 laps (100 L ÷ 4.20 L/lap).',
    );
  });

  it('says the two run out together when their whole laps are equal', () => {
    const together = buildPlanCards(
      planRace(rules, Array.from({length: 12}, () => lap(4.3, 4.3))),
      rules,
      false,
      RATIO,
      've',
    );
    // 100 L / 4.3 = 23.26 laps and 100 % / 4.3 = 23.26 laps
    expect(together.tank.limit).toBe('VE and fuel run out together: 23 laps.');
  });

  it('the Stops card: full tank first with its stint laps, VE per stint and the litres each stop refuels', () => {
    const full = cards.stops.full!;
    expect(full.stopAfter).toEqual(['L28', 'L56']);
    expect(full.stintLaps).toEqual([28, 28, 16]);
    // The formation burns no VE (it does not move before the green), so the
    // first stint is 28 x 3.5 = 98, like the second.
    expect(full.vePerStint.map(Math.round)).toEqual([98, 98, 56]);
    // And the fuel the same stints use: the formation's 0.4 laps of fuel on
    // the first, (28 + 0.4) x 2.38, then 28 x 2.38 and 16 x 2.38.
    expect(full.fuelPerStint.map(Math.round)).toEqual([68, 67, 38]);
    // One line per stint, one number a cell, in the unit shown (VE first). The
    // formation lap has its own row.
    expect(full.lines).toEqual([
      {n: 1, laps: 'L1–L28', use: '98 %', refuel: '67.6 L', stopAfter: 'L28'},
      {n: 2, laps: 'L29–L56', use: '98 %', refuel: '36.7 L', stopAfter: 'L56'},
      {n: 3, laps: 'L57–L72', use: '56 %', refuel: null, stopAfter: null},
    ]);
    // The ranges and the stops are one answer: each stint ends on the lap the
    // stop after it is named for, and the next one starts the lap after.
    expect(full.lines.map(l => l.laps.split('–')[1])).toEqual([
      'L28',
      'L56',
      'L72',
    ]);
    // The equal-stints table partitions the race the same way.
    const equal = cards.stops.equal;
    if (equal)
      equal.lines.forEach((l, i) => {
        const last = l.laps.split('–').pop();
        if (l.stopAfter) expect(last).toBe(l.stopAfter);
        if (i > 0) {
          const prevLast = Number(
            equal.lines[i - 1].laps.split('–').pop()!.slice(1),
          );
          expect(Number(l.laps.split('–')[0].slice(1))).toBe(prevLast + 1);
        }
      });
    expect(cards.stops.formationUse).toBe('0.0 %');
    expect(cards.stops.perStintHeader).toBe('VE per stint');
    expect(cards.stops.refuelHeader).toBe('Refuel');
    const fuelCards = buildPlanCards(
      planRace(rules, history()),
      rules,
      false,
      RATIO,
      'fuel',
      refuelRateOf([], 'GT3'),
    );
    expect(fuelCards.stops.full!.lines.map(l => l.use)).toEqual([
      '67 L',
      '67 L',
      '38 L',
    ]);
    expect(fuelCards.stops.formationUse).toBe('1.0 L');
    expect(fuelCards.stops.perStintHeader).toBe('Fuel per stint');
    // The refuelling seconds come from the litres at the GT3 rate, and are
    // litres for a class the rate is not measured for.
    expect(fuelCards.stops.refuelHeader).toBe('Refuel time');
    expect(fuelCards.stops.full!.lines.map(l => l.refuel)).toEqual([
      '19.9 s',
      '10.8 s',
      null,
    ]);
    // Two stops. Stop 1 refills what stint 1 (28 + the formation) used. Stop 2
    // adds only what the last 16 laps need: VE is the limit here. Stint 2 used
    // 28 x 3.5 = 98 % VE, so 2 % is left, and 16 x 3.5 = 56 % needs 54 %
    // more, x 0.68 L per % = 36.7 L; the fuel need (16 x 2.38 = 38.08 L less
    // the 33.4 L still in the tank) is only 4.7 L, so VE wins. Capped at the
    // refill (67.6 L), and marked as enough to finish.
    expect(
      full.refuel.map(r => [Math.round(r.litres * 10) / 10, r.toFinish]),
    ).toEqual([
      [67.6, false],
      [36.7, true],
    ]);
  });

  it('with fuel as the only meter the last stop adds what the remaining laps need, not a full refill', () => {
    const fuelOnlyPlan = planRace(rules, history(false));
    const c = buildPlanCards(fuelOnlyPlan, rules, true);
    const full = c.stops.full!;
    // Fuel alone: 41 laps in the first stint (and the formation's 0.4 laps),
    // then the last 31: less than the 98.5 L the first stint used, so it adds
    // what they need, enough to finish, not a full refill.
    expect(full.stintLaps).toEqual([41, 31]);
    expect(full.refuel).toEqual([
      // 31 x 2.38 = 73.78 L, less the 100 - 41.4 x 2.38 = 1.47 L still in the tank.
      {
        litres: expect.closeTo(31 * 2.38 - (100 - 41.4 * 2.38), 5),
        toFinish: true,
      },
    ]);
  });

  it('a short last stint on fuel alone subtracts what is still in the tank', () => {
    const long: PlanRules = {...rules, lengthMin: null, lengthLaps: 50};
    const c = buildPlanCards(planRace(long, history(false)), long, true);
    const full = c.stops.full!;
    // Stint 1 is 41 laps, the last is 9: 9 x 2.38 = 21.4 L needed, and after
    // 41.4 x 2.38 = 98.5 L used the tank holds 1.47 L, so it adds 19.95 L.
    expect(full.stintLaps).toEqual([41, 9]);
    expect(full.refuel[0].toFinish).toBe(true);
    expect(full.refuel[0].litres).toBeCloseTo(
      9 * 2.38 - (100 - 41.4 * 2.38),
      2,
    );
  });

  it('the Stops card: a pit window for each stop, at p90 use, with the median lap beside it', () => {
    // 72 laps (the plan's own count: the lap a late flag adds is a margin line,
    // not a stop), stints of 28 then 28 (the formation burns no VE). Use does
    // not vary here, so p90 = median: the plan stop is the window's latest end.
    expect(cards.stops.windows).toEqual([
      {
        stop: 1,
        earliest: 16,
        latest: 28,
        planLap: 28,
        medianLap: 28,
        text: 'Stop 1: after L16 to L28 · 13 laps · at median use L28',
      },
      {
        stop: 2,
        earliest: 44,
        latest: 56,
        planLap: 56,
        medianLap: 56,
        text: 'Stop 2: after L44 to L56 · 13 laps · at median use L56, within 28 laps of stop 1',
      },
    ]);
    expect(cards.stops.windowNote).toBeNull();
  });

  it('a timed race: the windows use the own lap count, and the late-flag lap is a margin line', () => {
    const plan = planRace(rules, history());
    expect(plan.raceLaps?.estimate).toBe(72);
    expect(plan.raceLaps?.oneMore).toBe(73);
    const stops = buildPlanCards(plan, rules, false, RATIO).stops;
    const p90 = plan.atP90;
    const atEstimate = pitWindows(
      p90.firstStint.laps as number,
      p90.stint.laps as number,
      72,
      2,
    )[0];
    expect(stops.windows[0].earliest).toBe(atEstimate.earliest);
    // The lap the flag can add is a fact with its numbers, not a stop.
    expect(stops.lateFlag).toBe(
      'Late flag 73 laps · +1 lap 3.5 % VE at p90 · +2.4 L at the last stop',
    );
    // A race counted in laps has no late flag: no margin line.
    const lapsRace: PlanRules = {...rules, lengthMin: null, lengthLaps: 72};
    const fixed = planRace(lapsRace, history());
    expect(fixed.raceLaps?.oneMore ?? null).toBeNull();
    const fixedStops = buildPlanCards(fixed, lapsRace, false, RATIO).stops;
    expect(fixedStops.lateFlag).toBeNull();
    expect(fixedStops.windows[0].earliest).toBe(atEstimate.earliest);
  });

  it('a plan with no stop gets no window, even where the late flag would need one', () => {
    // 46.5 min is 28 laps: the first load goes 28, so no stop. At the late-flag
    // length, 29 laps, a stop would be needed; that is not a pit window to show.
    const short: PlanRules = {...rules, lengthMin: 46.5};
    const plan = planRace(short, history());
    expect(plan.raceLaps?.estimate).toBe(28);
    expect(plan.raceLaps?.oneMore).toBe(29);
    expect(plan.atMedian.stopLaps).toEqual([]);
    const {stops} = buildPlanCards(plan, short, false, RATIO);
    expect(stops.windows).toEqual([]);
    // It is the run-dry case, so the card says so. The rules cap the load, so
    // the alternative to a stop is a use rate: the capped load over the
    // late-flag laps, the formation sharing it (no VE: it does not move before the green),
    // in the meter that limits (VE here: 3.5 % a lap on a 100 % load).
    const late = (
      plan.loadToFinish as NonNullable<typeof plan.loadToFinish>
    )[1];
    expect(late.laps).toBe(29);
    expect(late.atP90.limitedBy).toBe('ve');
    const atMost = (short.vePct / late.laps).toFixed(2);
    expect(atMost).toBe('3.45');
    expect(stops.windowNote).toBe(
      `Late flag: one stop, or at most ${atMost} % a lap.`,
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

  it('one plan: the Race card, the Stops row and the windows count the p90 stops, and the Race card keeps the median as a fact', () => {
    // A third of the laps at 3.6 L: p90 use is far above the median.
    const heavy = [
      ...Array.from({length: 8}, () => lap(2.38, 3.5)),
      ...Array.from({length: 4}, () => lap(3.6, 5.2)),
    ];
    const plan = planRace(rules, heavy);
    const extra = plan.atP90.stopLaps.length - plan.atMedian.stopLaps.length;
    expect(extra).toBeGreaterThan(0);
    const c = buildPlanCards(plan, rules, false, RATIO);
    // One list: the p90 stops, everywhere.
    expect(c.race.stops).toBe(plan.atP90.stopLaps.length);
    expect(c.stops.windows).toHaveLength(plan.atP90.stopLaps.length);
    expect(c.stops.full!.stopAfter).toEqual(c.race.stopAfter);
    expect(c.stops.windows.map(w => w.planLap)).toEqual(plan.atP90.stopLaps);
    // The median's count is a fact beside it, only where it differs.
    expect(c.race.medianNote).toBe(
      `At median use: ${plan.atMedian.stopLaps.length} stops.`,
    );
    expect(cards.race.medianNote).toBeNull();
  });

  it('the last stop is sized at the p90 use, so the final stint reaches the flag in the heavy laps too', () => {
    // A third of the laps at 3.6 L / 5.2 %: p90 use is far above the median.
    const heavy = [
      ...Array.from({length: 8}, () => lap(2.38, 3.5)),
      ...Array.from({length: 4}, () => lap(3.6, 5.2)),
    ];
    const plan = planRace(rules, heavy);
    const full = buildPlanCards(plan, rules, false, RATIO).stops.full!;
    const last = full.refuel[full.refuel.length - 1];
    const i = full.stintLaps.length - 2;
    const remaining = full.stintLaps[i + 1];
    const form = i === 0 ? 1 : 0;
    const {fuel, ve} = plan.perLap;
    // What the tank holds on arrival and what the remaining laps need, at p90.
    const fuelLeft = Math.max(
      0,
      LOAD_L -
        Math.min(LOAD_L, (full.stintLaps[i] + form) * fuel!.p90),
    );
    const veLeft = Math.max(
      0,
      rules.vePct - Math.min(rules.vePct, (full.stintLaps[i] + form) * ve!.p90),
    );
    const needL = Math.max(
      remaining * fuel!.p90 - fuelLeft,
      (remaining * ve!.p90 - veLeft) * RATIO,
    );
    // Enough to finish at the p90 use: exactly that when it is less than a
    // full refill, else the full refill (which the p90 need exceeds).
    if (last.toFinish) expect(last.litres).toBeCloseTo(needL, 6);
    else expect(needL).toBeGreaterThanOrEqual(last.litres - 1e-9);
    // Sized at the median use it would have been smaller (the bug parc found).
    const medianNeed = Math.max(
      remaining * fuel!.median -
        Math.max(0, LOAD_L - (full.stintLaps[i] + form) * fuel!.median),
      (remaining * ve!.median -
        Math.max(0, rules.vePct - (full.stintLaps[i] + form) * ve!.median)) *
        RATIO,
    );
    expect(needL).toBeGreaterThan(medianNeed);
  });

  it('the Stops card: equal stints second, over the same race', () => {
    const equal = cards.stops.equal!;
    expect(equal.kind).toBe('equal');
    expect(equal.stintLaps).toEqual([24, 24, 24]);
    expect(equal.stopAfter).toEqual(['L24', 'L48']);
    expect(equal.stintLaps.reduce((a, b) => a + b, 0)).toBe(72);
  });
});

describe('the fuel-only plan', () => {
  const plan = planRace(rules, history(false));
  const cards = buildPlanCards(plan, rules, true);

  it('has one meter, fuel, and nothing to say about another', () => {
    expect(cards.tank.meters.map(m => m.key)).toEqual(['fuel']);
    expect(cards.tank.limit).toBeNull();
  });

  it('has no VE per stint, and stints set by fuel', () => {
    expect(cards.stops.full!.vePerStint).toEqual([]);
    // Fuel alone: (100 - 2.38) / 2.38 = 41 laps in the first stint.
    expect(cards.stops.full!.stintLaps[0]).toBe(41);
    expect(cards.stops.full!.stopAfter).toEqual(['L41']);
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

describe('the start load', () => {
  const short: PlanRules = {...rules, lengthMin: 20};
  const withStops = buildPlanCards(
    planRace(rules, history()),
    rules,
    false,
    RATIO,
  );
  const fits = buildPlanCards(planRace(short, history()), short, false, RATIO);

  it('a race that fits one load reads the load to the flag in VE, litres beside, and one lap more', () => {
    expect(fits.race.startLoad).toEqual({
      // 20 min is 12 laps, 13 at the late flag: 13 x 3.5 = 45.5, + the 1 % floor at the flag = 46.5 -> 47 %.
      value: '47 % VE (47 L)',
      hero: '47 % VE',
      covers: 'to finish',
    });
  });

  it('the litres beside VE are its share of the full load of the event, not the fuel burned (parc #2017)', () => {
    const small: PlanRules = {...short, fuelL: 86};
    const cards = buildPlanCards(
      planRace(small, history()),
      small,
      false,
      RATIO,
    );
    // The VE is the rounded 47 % of 86 L; 100 L would read 47 L.
    expect(cards.race.startLoad?.value).toBe('47 % VE (40 L)');
  });

  it('asking for fuel shows litres only', () => {
    const fuel = buildPlanCards(
      planRace(short, history()),
      short,
      false,
      RATIO,
      'fuel',
    );
    // 13 laps at the late flag and the formation's 0.4: 13.4 x 2.38 = 31.9 L.
    expect(fuel.race.startLoad?.value).toBe('32 L');
  });

  it('a race with stops reads the first stint, which sets the stop plan', () => {
    expect(withStops.race.startLoad?.covers).toBe('for the first stint');
  });

  it('says nothing without a use per lap', () => {
    const none = buildPlanCards(planRace(short, []), short, false, RATIO);
    expect(none.race.startLoad).toBeNull();
  });
});
