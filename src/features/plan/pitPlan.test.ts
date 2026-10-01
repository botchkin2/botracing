import {describe, expect, it} from '@jest/globals';

import {type GreenLap, planRace, type PlanRules} from '@/src/analysis/fuelPlan';

import {lapAt, pitPlan, type PitPlanInput, plannedStops} from './pitPlan';
import {buildPlanCards} from './planCards';
import {finalStintWarning, stintRow, stopLine, unitOf} from './pitPlanText';

// planCards.test.ts's example: a 2 h race at 101.2 s a lap, 2.38 L and 3.5 % VE
// a lap, a 100 L / 100 % load and a formation lap, with the pit model.
const rules: PlanRules = {
  name: 'ELMS 2 h',
  lengthLaps: null,
  lengthMin: 120,
  fuelL: 100,
  vePct: 100,
  formationLap: true,
  mandatoryStops: 0,
};
const lap = (fuelL: number): GreenLap => ({
  fuelL,
  vePct: 3.5,
  lapTimeS: 101.2,
  sessionId: 's',
});
const RATIO = 0.68;
const pitModel = {baseS: 45, refuelLPerS: 3.4};

function setup(over: Partial<PlanRules> = {}, model = pitModel) {
  const r = {...rules, ...over};
  const plan = planRace(
    r,
    Array.from({length: 12}, () => lap(2.38)),
    model,
  );
  const cards = buildPlanCards(plan, r, false, RATIO);
  const input: PitPlanInput = {
    plan,
    rules: r,
    fuelOnly: false,
    ratioPerPctL: RATIO,
    pitModel: model,
    windows: cards.stops.windows,
  };
  return {input, plan, cards};
}

describe('pitPlan', () => {
  it("at the planned stops it is the Race card's plan: same finish, nothing moved", () => {
    const {input, plan} = setup();
    const p = pitPlan(input)!;
    expect(p.finishLaps).toBe(plan.raceLaps!.estimate);
    expect(p.finishDelta).toBe(0);
    expect(p.moved).toBe(false);
    expect(p.stops.map(s => s.after)).toEqual(plannedStops(input.windows));
    expect(p.stints.reduce((a, s) => a + s.laps, 0)).toBe(p.finishLaps);
    expect(p.pit!.deltaS).toBe(0);
  });

  it('every stop is bounded by its window at the early end and the median dry lap at the late end', () => {
    const {input} = setup();
    const p = pitPlan(input)!;
    p.stops.forEach((s, i) => {
      expect(s.min).toBeGreaterThanOrEqual(input.windows[i].earliest);
      expect(s.after).toBeGreaterThanOrEqual(s.min);
      expect(s.after).toBeLessThanOrEqual(s.p90Max);
      expect(s.p90Max).toBeLessThanOrEqual(s.max);
    });
    // The first stop's late end is the lap the first load runs out at the median use.
    expect(p.stops[0].max).toBe(
      Math.floor(input.plan.atMedian.firstStint.laps!),
    );
  });

  it('a stop dragged past the median dry lap is held there; between the p90 and median ends it runs dry at p90 only', () => {
    const {input} = setup();
    const planned = pitPlan(input)!;
    const far = pitPlan(input, [
      999,
      ...planned.stops.slice(1).map(s => s.after),
    ])!;
    expect(far.stops[0].after).toBe(planned.stops[0].max);
    expect(far.stints[0].dryAtMedian).toBe(false);
    if (planned.stops[0].max > planned.stops[0].p90Max) {
      expect(far.stints[0].dryAtP90).toBe(true);
    }
    expect(planned.stints[0].dryAtP90).toBe(false);
  });

  it('moving a stop earlier lengthens the stint after it and re-clamps the stops that follow', () => {
    const {input} = setup();
    const planned = pitPlan(input)!;
    const early = pitPlan(input, [planned.stops[0].min])!;
    expect(early.moved).toBe(true);
    expect(early.stints[0].laps).toBe(planned.stops[0].min);
    // The next stop was past a median tank from the new one, so it is held there.
    expect(early.stints[1].laps).toBe(input.plan.atMedian.stint.laps);
    // The second stop cannot come more than a median tank after the first.
    expect(early.stops[1].after).toBeLessThanOrEqual(
      early.stops[0].after + input.plan.atMedian.stint.laps!,
    );
  });

  it('a stop never goes below its minimum or past the lap before the flag', () => {
    const {input} = setup();
    const low = pitPlan(input, [-5, -5])!;
    expect(low.stops[0].after).toBe(low.stops[0].min);
    const high = pitPlan(input, [9999, 9999])!;
    expect(high.stops[1].after).toBeLessThan(high.finishLaps);
  });

  it('tyre laps: the stint on a changed set, and the laps if never changed', () => {
    const {input} = setup();
    const p = pitPlan(input)!;
    expect(p.stints[0].tyreLaps).toEqual({
      onSet: p.stints[0].laps,
      sinceStart: p.stints[0].laps,
    });
    expect(p.stints[1].tyreLaps.sinceStart).toBe(
      p.stints[0].laps + p.stints[1].laps,
    );
    expect(p.stints.at(-1)!.tyreLaps.sinceStart).toBe(p.finishLaps);
  });

  it('the first stint carries the formation lap in what it uses', () => {
    const {input, plan} = setup();
    const p = pitPlan(input)!;
    expect(p.stints[0].fuelL!.median).toBeCloseTo(
      (p.stints[0].laps + 1) * plan.perLap.fuel!.median,
    );
    expect(p.stints[1].fuelL!.median).toBeCloseTo(
      p.stints[1].laps * plan.perLap.fuel!.median,
    );
  });

  it('a race in laps keeps its laps; without a pit model there is no pit time', () => {
    const laps = setup({lengthLaps: 70, lengthMin: null});
    const p = pitPlan(laps.input)!;
    expect(p.finishLaps).toBe(70);
    const noPit = setup({}, null as never);
    const q = pitPlan({...noPit.input, pitModel: null})!;
    expect(q.pit).toBeNull();
    expect(q.stops.every(s => s.pitS == null)).toBe(true);
  });

  it('a plan with no stop has no slider', () => {
    const {input} = setup({lengthMin: 20});
    expect(pitPlan({...input, windows: []})).toBeNull();
  });
});

describe('the stint after the last stop', () => {
  // Every pair of stop positions the sliders can reach: none shows a stint
  // that is empty at the median use, in a timed race where the finish moves.
  it('never shows a stint empty at the median use, wherever the stops are', () => {
    for (const model of [pitModel, {baseS: 5, refuelLPerS: 8}]) {
      const {input} = setup({}, model);
      const planned = pitPlan(input)!;
      const [a, b] = planned.stops;
      for (let x = a.min; x <= a.max; x++)
        for (let y = b.min; y <= b.max; y++) {
          const p = pitPlan(input, [x, y])!;
          expect(p.stints.some(s => s.dryAtMedian)).toBe(false);
        }
    }
  });

  it('a late last stop leaves a final stint that is dry at p90 only, and says so', () => {
    const {input} = setup();
    const planned = pitPlan(input)!;
    const last = planned.stops.length;
    const asked = planned.stops.map(s => s.after);
    // Hold the first stop and take the last stop as early as it can go.
    asked[last - 1] = planned.stops[last - 1].min;
    const p = pitPlan(input, asked)!;
    expect(p.stints.some(s => s.dryAtMedian)).toBe(false);
    expect(finalStintWarning(p)).toBe(
      p.stints[p.stints.length - 1].dryAtP90
        ? `At p90 use stint ${p.stints.length} runs dry before the flag: a tank covers fewer laps in the heavier 10 % of the laps.`
        : null,
    );
  });

  it('the text names a median-dry final stint when the model reports one', () => {
    const {input} = setup();
    const p = pitPlan(input)!;
    const dry = {
      ...p,
      stints: p.stints.map((s, i) =>
        i === p.stints.length - 1 ? {...s, dryAtMedian: true} : s,
      ),
    };
    expect(finalStintWarning(dry)).toBe(
      `Stint ${p.stints.length} runs dry before the flag at the median use.`,
    );
  });
});

describe('describing a stop in one unit', () => {
  it('leads with VE where the plan has VE, fuel otherwise; litres stay for the refuel', () => {
    const {input} = setup();
    const p = pitPlan(input)!;
    expect(unitOf(p)).toBe('ve');
    expect(stopLine(p.stops[0], p.stints[0], 've')).toMatch(
      /^arrives with \d+\.\d % VE left · adds \d+\.\d L · \d+ s in the pit$/,
    );
    expect(stopLine(p.stops[0], p.stints[0], 'fuel')).toMatch(
      /^arrives with \d+\.\d L left · adds/,
    );
    expect(stintRow(p.stints[0], 've').use).toMatch(/ %$/);
    expect(stintRow(p.stints[0], 'fuel').use).toMatch(/ L$/);
  });
});

describe('lapAt', () => {
  it('maps a pointer on a track to a whole lap and holds it inside', () => {
    expect(lapAt(0, 200, 10, 30)).toBe(10);
    expect(lapAt(100, 200, 10, 30)).toBe(20);
    expect(lapAt(199, 200, 10, 30)).toBe(30);
    expect(lapAt(-40, 200, 10, 30)).toBe(10);
    expect(lapAt(900, 200, 10, 30)).toBe(30);
    expect(lapAt(5, 0, 10, 30)).toBe(10);
  });
});
