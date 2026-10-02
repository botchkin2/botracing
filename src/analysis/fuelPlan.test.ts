import {describe, expect, it} from '@jest/globals';

import {
  type GreenLap,
  MAX_PIT_PASSES,
  MIN_COMPARE_LAPS,
  planRace,
  presetMismatch,
  startLoad,
  stopRefuels,
  type PlanRules,
  usage,
} from './fuelPlan';

const rules = (over: Partial<PlanRules> = {}): PlanRules => ({
  name: 'test',
  lengthLaps: 40,
  lengthMin: null,
  fuelL: 84,
  vePct: 100,
  formationLap: false,
  mandatoryStops: 0,
  ...over,
});

// n green laps of the same use and lap time, from two sessions.
const laps = (
  n: number,
  fuelL: number,
  vePct: number | null,
  lapTimeS = 110,
): GreenLap[] =>
  Array.from({length: n}, (_, i) => ({
    fuelL,
    vePct,
    lapTimeS,
    sessionId: i % 2 ? 'a' : 'b',
  }));

describe('usage', () => {
  it('needs three laps', () => {
    expect(usage([3, 3.1])).toBeNull();
    expect(usage([3, 3.1, 3.2])).toMatchObject({median: 3.1, n: 3});
  });

  it('gives the median and the tails', () => {
    const u = usage([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])!;
    expect(u.median).toBe(5.5);
    expect(u.p10).toBeCloseTo(1.9);
    expect(u.p90).toBeCloseTo(9.1);
  });
});

describe('planRace', () => {
  it('shows nothing without history', () => {
    const p = planRace(rules(), []);
    expect(p.history).toEqual({laps: 0, sessions: 0});
    expect(p.perLap).toEqual({fuel: null, ve: null, lapTimeS: null});
    expect(p.atMedian.stops).toBeNull();
    expect(p.atMedian.stint.laps).toBeNull();
    expect(p.dropStop).toBeNull();
  });

  it('shows nothing under three green laps', () => {
    const p = planRace(rules(), laps(2, 3.5, 5));
    expect(p.perLap.fuel).toBeNull();
    expect(p.atMedian.stops).toBeNull();
  });

  it('names VE as the limit when it runs out first', () => {
    // 84 L at 3.5 L is 24 laps; 100 % at 5 % is 20.
    const p = planRace(rules(), laps(10, 3.5, 5));
    expect(p.atMedian.stint).toEqual({
      fuelLaps: 24,
      veLaps: 20,
      laps: 20,
      limitedBy: 've',
    });
  });

  it('names fuel as the limit when it runs out first', () => {
    // 84 L at 4.2 L is 20 laps; 100 % at 3 % is 33.
    const p = planRace(rules(), laps(10, 4.2, 3));
    expect(p.atMedian.stint).toMatchObject({laps: 20, limitedBy: 'fuel'});
  });

  it('has no limit to name when both agree', () => {
    const p = planRace(rules({fuelL: 100}), laps(10, 5, 5));
    expect(p.atMedian.stint).toMatchObject({laps: 20, limitedBy: null});
  });

  it('plans from fuel alone without a VE channel', () => {
    const p = planRace(rules(), laps(10, 3.5, null));
    expect(p.perLap.ve).toBeNull();
    expect(p.atMedian.stint).toMatchObject({
      fuelLaps: 24,
      veLaps: null,
      laps: 24,
      limitedBy: null,
    });
  });

  it('counts stops and stop laps for a full-tank strategy', () => {
    // 20-lap stints over 45 laps: stops after laps 20 and 40.
    const p = planRace(rules({lengthLaps: 45}), laps(10, 3.5, 5));
    expect(p.atMedian.stops).toBe(2);
    expect(p.atMedian.stopLaps).toEqual([20, 40]);
    // Even split of the same three stints.
    expect(p.atMedian.even).toEqual({
      firstLaps: 15,
      firstFuelL: 15 * 3.5,
      firstVePct: 15 * 5,
      laps: 15,
      fuelL: 15 * 3.5,
      vePct: 15 * 5,
    });
    expect(p.atMedian.anyLapStops).toBe(0);
  });

  it('needs no stop when the race is shorter than a stint', () => {
    const p = planRace(rules({lengthLaps: 18}), laps(10, 3.5, 5));
    expect(p.atMedian.stops).toBe(0);
    expect(p.atMedian.stopLaps).toEqual([]);
    expect(p.dropStop).toBeNull();
  });

  it('a race of exactly one stint needs no stop', () => {
    expect(
      planRace(rules({lengthLaps: 20}), laps(10, 3.5, 5)).atMedian.stops,
    ).toBe(0);
    expect(
      planRace(rules({lengthLaps: 21}), laps(10, 3.5, 5)).atMedian.stops,
    ).toBe(1);
  });

  it('raises the stops to the mandatory number', () => {
    const p = planRace(
      rules({lengthLaps: 18, mandatoryStops: 1}),
      laps(10, 3.5, 5),
    );
    expect(p.atMedian.stops).toBe(1);
    // The fuel needs no stop, so the mandatory one can go on any lap.
    expect(p.atMedian.stopLaps).toEqual([]);
    expect(p.atMedian.anyLapStops).toBe(1);
  });

  it('counts only the mandatory stops beyond the fuel ones as any-lap', () => {
    const p = planRace(
      rules({lengthLaps: 45, mandatoryStops: 3}),
      laps(10, 3.5, 5),
    );
    expect(p.atMedian.stops).toBe(3);
    expect(p.atMedian.stopLaps).toEqual([20, 40]);
    expect(p.atMedian.anyLapStops).toBe(1);
  });

  it('carries the spread: the p90 use can take a stop more', () => {
    // Median 3.5 L and p90 4.2 L: 24 and 20 fuel laps; VE is not the limit.
    const history = [...laps(7, 3.5, 2), ...laps(3, 4.2, 2)];
    const p = planRace(rules({lengthLaps: 45}), history);
    expect(p.perLap.fuel!.median).toBeCloseTo(3.5);
    expect(p.atMedian.stint.laps).toBe(24);
    expect(p.atP90.stint.laps).toBe(20);
    expect(p.atMedian.stops).toBe(1);
    expect(p.atP90.stops).toBe(2);
  });

  it('takes the formation lap off the first stint only', () => {
    const p = planRace(
      rules({lengthLaps: 45, formationLap: true}),
      laps(10, 3.5, 5),
    );
    // (100 - 5) / 5 = 19 laps in the first stint, 20 after.
    expect(p.atMedian.firstStint.laps).toBe(19);
    expect(p.atMedian.stint.laps).toBe(20);
    expect(p.atMedian.stopLaps).toEqual([19, 39]);
  });

  it('keeps the formation lap in the first even stint', () => {
    // A 20-lap tank with the formation lap: 19 laps in the first stint. In a
    // 39-lap race that is one stop and an even split of 20, but 20 laps plus
    // the formation lap do not fit the first tank: it takes 19, the rest 20.
    const p = planRace(
      rules({lengthLaps: 39, formationLap: true}),
      laps(10, 3.5, 5),
    );
    expect(p.atMedian.stops).toBe(1);
    expect(p.atMedian.even).toEqual({
      firstLaps: 19,
      firstFuelL: 20 * 3.5,
      firstVePct: 20 * 5,
      laps: 20,
      fuelL: 20 * 3.5,
      vePct: 20 * 5,
    });
  });

  it('gives a stint of no laps no stop count', () => {
    // 3.5 L tank against 4 L a lap.
    const p = planRace(rules({fuelL: 3.5}), laps(10, 4, 5));
    expect(p.atMedian.stint.laps).toBe(0);
    expect(p.atMedian.stops).toBeNull();
  });

  it('reads a timed race at the median lap time; the flag can fall one lap later', () => {
    // 60 min at 110 s is 32.7, so the flag comes on lap 33, or 34 when it falls late.
    const p = planRace(
      rules({lengthLaps: null, lengthMin: 60}),
      laps(10, 3.5, 5, 110),
    );
    expect(p.raceLaps).toEqual({
      estimate: 33,
      oneMore: 34,
      pit: null,
      settled: true,
    });
  });

  it('a race in laps has no one-more', () => {
    const p = planRace(rules({lengthLaps: 40}), laps(10, 3.5, 5));
    expect(p.raceLaps).toEqual({
      estimate: 40,
      oneMore: null,
      pit: null,
      settled: true,
    });
  });

  it('a timed race without lap history has no length', () => {
    const p = planRace(rules({lengthLaps: null, lengthMin: 60}), []);
    expect(p.raceLaps).toBeNull();
    expect(p.atMedian.stops).toBeNull();
  });

  it('counts the sessions the laps came from', () => {
    expect(planRace(rules(), laps(10, 3.5, 5)).history).toEqual({
      laps: 10,
      sessions: 2,
    });
  });
});

describe('pit time in a timed race', () => {
  const timed = rules({lengthLaps: null, lengthMin: 120});
  const history = laps(10, 3, null);
  const model = {baseS: 45, refuelLPerS: 3.4};

  it('is not counted without a pit model', () => {
    const r = planRace(timed, history).raceLaps!;
    expect(r).toEqual({estimate: 66, oneMore: 67, pit: null, settled: true});
  });

  it('takes stops x (base + refuel) off the clock', () => {
    const r = planRace(timed, history, model).raceLaps!;
    // 28-lap stints (84 L / 3), so 2 stops: the first refills 84 L, and the
    // last adds only what the last 9 of 65 laps take at the p90 use (27 L), not
    // a full refill: 2 x 45 s + 111 L / 3.4 L/s.
    expect(r.pit).toMatchObject({
      stops: 2,
      baseS: 45,
      refuelL: 111,
      lapsWithout: 66,
    });
    expect(r.pit!.totalS).toBeCloseTo(2 * 45 + 111 / 3.4, 6);
    expect(r.pit!.perStopS).toBeCloseTo((2 * 45 + 111 / 3.4) / 2, 6);
    expect(r.estimate).toBe(65);
    expect(r.oneMore).toBe(66);
  });

  it('takes the stops of the p90 plan, at the laps it ends on, and the laps agree with the pit time (fixed point)', () => {
    // Le Mans 4 h in a 911: 84 L / 100 % VE, 9.37 % VE and 7.61 L a lap, 241.6 s.
    // 60 laps would take 6 stops (404 s), which leaves time for 58; 58 laps
    // takes 5 stops (337 s), which gives 59; 59 laps takes 5 stops again.
    const lemans = rules({
      lengthLaps: null,
      lengthMin: 240,
      formationLap: true,
    });
    const hist = laps(35, 7.61, 9.37, 241.6);
    const plan = planRace(lemans, hist, model);
    const r = plan.raceLaps!;
    expect(r.settled).toBe(true);
    expect(r.estimate).toBe(59);
    expect(r.pit!.lapsWithout).toBe(60);
    // The pit time is that of the stops the plan shows, and gives the laps.
    expect(r.pit!.stops).toBe(plan.atP90.stopLaps.length);
    expect(Math.ceil((240 * 60 - r.pit!.totalS) / 241.6)).toBe(r.estimate);
  });

  it('at a boundary the stops and the laps never agree: after MAX_PIT_PASSES passes the longest pit time decides, and it says so', () => {
    // 90 min at 95 s a lap, 100 L: 57 laps without pit time need 2 stops, whose
    // 219 s leave 55 laps; 55 laps need only 1 stop (110 s), which leaves 56;
    // 56 laps need 2 stops again.
    const edge = rules({
      lengthLaps: null,
      lengthMin: 90,
      formationLap: true,
      fuelL: 100,
    });
    const hist = laps(12, 2.38, 3.5, 95);
    const slow = planRace(edge, hist, {baseS: 90, refuelLPerS: 3.4}).raceLaps!;
    expect(MAX_PIT_PASSES).toBe(3);
    expect(slow.settled).toBe(false);
    expect(slow.pit!.stops).toBe(2);
    // The longest pit time (2 stops) gives the laps: the arithmetic holds.
    expect(slow.estimate).toBe(Math.ceil((90 * 60 - slow.pit!.totalS) / 95));
    expect(slow.estimate).toBe(55);
    // A shorter stop (base 60) settles on 56 laps with 2 stops.
    const quick = planRace(edge, hist, {baseS: 60, refuelLPerS: 3.4}).raceLaps!;
    expect(quick.settled).toBe(true);
    expect(quick.estimate).toBe(56);
    expect(quick.pit!.stops).toBe(2);
  });

  it('is left out with no stop to make, no fuel history or a race in laps', () => {
    const short = rules({lengthLaps: null, lengthMin: 40});
    expect(planRace(short, history, model).raceLaps!.pit).toBeNull();
    expect(
      planRace(
        timed,
        laps(10, 3, null).map(l => ({...l, fuelL: NaN})),
        model,
      ).raceLaps?.pit,
    ).toBeNull();
    expect(planRace(rules(), history, model).raceLaps!.pit).toBeNull();
  });
});

describe('a start load under the full one (thread 44 #1901/#1902)', () => {
  const base = rules({lengthLaps: 60, formationLap: true, fuelL: 100});
  const hist = laps(12, 2.38, 3.5);

  it('startLoad is the full load unless a start is set, and never above it', () => {
    expect(startLoad(base)).toEqual({fuelL: 100, vePct: 100});
    expect(startLoad({...base, startVePct: 87})).toEqual({
      fuelL: 100,
      vePct: 87,
    });
    expect(startLoad({...base, startVePct: 120, startFuelL: 60})).toEqual({
      fuelL: 60,
      vePct: 100,
    });
    expect(startLoad({...base, startVePct: null, startFuelL: 0})).toEqual({
      fuelL: 100,
      vePct: 100,
    });
  });

  it('only the first stint shortens: the stops come earlier and the later stints are full', () => {
    const full = planRace(base, hist);
    const short = planRace({...base, startVePct: 87}, hist);
    // 100 % VE at 3.5 a lap: (100 - 3.5) / 3.5 = 27 laps; 87 %: (87 - 3.5) / 3.5 = 23.
    expect(full.atMedian.firstStint.laps).toBe(27);
    expect(short.atMedian.firstStint.laps).toBe(23);
    expect(short.atMedian.stint.laps).toBe(full.atMedian.stint.laps);
    expect(short.atMedian.stopLaps[0]).toBe(23);
    expect(short.atMedian.stopLaps[1]).toBe(
      23 + (full.atMedian.stint.laps as number),
    );
    expect(short.atP90.stopLaps[0]).toBeLessThan(full.atP90.stopLaps[0]);
  });

  it('drop-a-stop shares the start load and the full loads over the laps; one load that fits is judged against the start', () => {
    const full = planRace(base, hist).dropStop!;
    const short = planRace({...base, startVePct: 87}, hist).dropStop!;
    // 60 laps + formation = 61 laps of use. 2 stops, so 1 stop to drop to: a
    // start of 87 % plus 100 % over 61 laps = 3.07 % a lap, against 3.33 % at
    // a full start (ceil(61 / 2) = 31 laps a load).
    expect(short.targetStops).toBe(full.targetStops);
    expect(short.vePerLapPct!).toBeCloseTo((87 + 100) / 61, 6);
    expect(full.vePerLapPct!).toBeCloseTo(100 / 31, 6);
    // One load, a race of 20 laps: a full tank covers it, a 50 % start needs a stop.
    const sprint = rules({lengthLaps: 20, formationLap: true, fuelL: 100});
    expect(planRace(sprint, hist).loadToFinish![0].atMedian.fits).toBe(true);
    const lowStart = planRace({...sprint, startVePct: 50}, hist);
    expect(lowStart.atP90.stops).toBeGreaterThan(0);
    expect(lowStart.loadToFinish).toBeNull();
  });

  it('the first stop of a one-stop plan is sized from the start load, not a full tank', () => {
    const one = rules({
      lengthLaps: 40,
      formationLap: false,
      fuelL: 100,
      startFuelL: 50,
    });
    // Stint 1: 20 laps at 2.38 L = 47.6 L of the 50 L start; the last 20 laps
    // need 47.6 L and 2.4 L is left: it adds 45.2 L, not a full refill.
    const refuels = stopRefuels(
      one,
      [20, 20],
      {fuel: 2.38, ve: null},
      null,
      null,
      false,
    );
    expect(refuels).toHaveLength(1);
    expect(refuels[0].toFinish).toBe(true);
    expect(refuels[0].litres).toBeCloseTo(45.2, 6);
  });
});

describe('drop one stop', () => {
  // 45 laps in 20-lap stints is 2 stops; 3 stints of 15 fit in one fewer at 23.
  const base = rules({lengthLaps: 45});

  it('gives the use per lap that saves a stop', () => {
    const p = planRace(base, laps(10, 3.5, 5));
    const d = p.dropStop!;
    expect(d.targetStops).toBe(1);
    // 45 laps in two stints: 23 laps each -> 84 / 23 L and 100 / 23 %.
    expect(d.fuelPerLapL).toBeCloseTo(84 / 23);
    expect(d.vePerLapPct).toBeCloseTo(100 / 23);
    expect(d.saveFuelL).toBeCloseTo(3.5 - 84 / 23);
    expect(d.saveVePct).toBeCloseTo(5 - 100 / 23);
    expect(d.saveVePctOfMedian).toBeCloseTo(((5 - 100 / 23) / 5) * 100);
  });

  it('says no data when he has too few laps that used that little', () => {
    const p = planRace(base, laps(10, 3.5, 5));
    // Fuel (3.5 L) would still reach at 3.65 L a lap: only VE has to drop.
    expect(p.dropStop!.compare).toEqual({
      n: 0,
      atMost: {fuelL: null, vePct: 100 / 23},
      lowestFuelL: null,
      lowestVePct: 5,
    });
  });

  it('quotes his lap times when at least five laps used that little', () => {
    const slow = laps(MIN_COMPARE_LAPS, 3.0, 4.0, 112);
    const normal = laps(10, 3.5, 5, 110);
    const d = planRace(base, [...slow, ...normal]).dropStop!;
    expect(d.compare).toEqual({
      n: MIN_COMPARE_LAPS,
      atMost: {fuelL: null, vePct: 100 / 23},
      medianLapTimeS: 112,
      allMedianLapTimeS: 110,
    });
  });

  it('filters by the meter that has to drop, not the one that would reach', () => {
    // Fuel use is above the fuel figure but fuel is not the limit; VE is low.
    const heavyFuelLowVe = laps(6, 3.9, 4.0, 111);
    const d = planRace(base, [...heavyFuelLowVe, ...laps(6, 3.4, 5)]).dropStop!;
    expect(d.saveFuelL! > 0).toBe(false);
    expect((d.compare as {n: number}).n).toBe(6);
  });

  it('counts only laps under both limits', () => {
    // Fuel is low enough but VE is not.
    const p = planRace(base, [...laps(6, 3.0, 5), ...laps(4, 3.5, 5)]);
    expect((p.dropStop!.compare as {n: number}).n).toBe(0);
  });

  it('shares the formation lap out with the race laps', () => {
    const d = planRace(
      rules({lengthLaps: 45, formationLap: true}),
      laps(10, 3.5, 5),
    ).dropStop!;
    // 45 laps + the formation lap on 2 loads: 23 laps of use per load.
    expect(d.fuelPerLapL).toBeCloseTo(84 / 23);
  });

  it('65 laps and a formation lap on two loads is 33 laps of use per load', () => {
    // Apex's case (thread 35 #1032): 66 laps of use on 2 loads = 33 each, so
    // 100 L allows 100 / 33 = 3.03 L a lap, not 100 / 34.
    const d = planRace(
      rules({lengthLaps: 65, fuelL: 100, formationLap: true}),
      laps(10, 3.5, 3),
    ).dropStop!;
    expect(d.targetStops).toBe(1);
    expect(d.fuelPerLapL).toBeCloseTo(100 / 33);
  });

  it('has nothing to drop past the mandatory stops', () => {
    const p = planRace(
      rules({lengthLaps: 45, mandatoryStops: 2}),
      laps(10, 3.5, 5),
    );
    expect(p.atMedian.stops).toBe(2);
    expect(p.dropStop).toBeNull();
  });
});

describe('a real case', () => {
  // Road Atlanta GT3, 75 L fill limit: the audit's median use per green lap
  // (thread 35) was 2.39 L and 3.53 % VE over 103 laps.
  it('finds the VE limit at 28 laps and 31 laps of fuel', () => {
    const history = [...laps(103, 2.39, 3.53, 88)];
    const p = planRace(
      rules({fuelL: 75, lengthLaps: 60, formationLap: false}),
      history,
    );
    expect(p.atMedian.stint).toEqual({
      fuelLaps: 31,
      veLaps: 28,
      laps: 28,
      limitedBy: 've',
    });
    expect(p.atMedian.stops).toBe(2);
    expect(p.atMedian.stopLaps).toEqual([28, 56]);
  });
});

describe('presetMismatch', () => {
  it('shows both numbers when the preset is not what he last ran', () => {
    expect(presetMismatch(75, 84)).toEqual({presetL: 75, lastL: 84});
  });

  it('is quiet when they agree, or when there is no last session', () => {
    expect(presetMismatch(84, 84)).toBeNull();
    expect(presetMismatch(84, 84.2)).toBeNull();
    expect(presetMismatch(84, null)).toBeNull();
  });
});

describe('load to finish', () => {
  // 40 min at 110 s is 22 laps, 23 if the flag falls late. History: a
  // median of 3.5 L and 3 % VE a lap, and heavier laps (p90) at 4.2 L and 3.6 %.
  const history = [...laps(7, 3.5, 3), ...laps(3, 4.2, 3.6)];
  const sprint = rules({
    lengthLaps: null,
    lengthMin: 40,
    fuelL: 100,
    formationLap: true,
  });

  it('is absent when the race needs a stop', () => {
    expect(planRace(rules({lengthLaps: 60}), history).loadToFinish).toBeNull();
  });

  it('gives the load for the race laps and one more, with the formation lap', () => {
    const p = planRace(sprint, history);
    expect(p.raceLaps).toEqual({
      estimate: 22,
      oneMore: 23,
      pit: null,
      settled: true,
    });
    const [own, more] = p.loadToFinish!;
    expect(own.laps).toBe(22);
    // 22 laps + the formation lap at 3.5 L and 5 %.
    expect(own.atMedian.fuelL).toBeCloseTo(23 * 3.5);
    expect(own.atMedian.vePct).toBeCloseTo(23 * 3);
    expect(more.laps).toBe(23);
    expect(more.atMedian.fuelL).toBeCloseTo(24 * 3.5);
  });

  it('names the meter closer to its cap', () => {
    const [own] = planRace(sprint, history).loadToFinish!;
    // 80.5 L of 100 L is 0.805 of the cap; 69 % VE of 100 % is 0.69.
    expect(own.atMedian.limitedBy).toBe('fuel');
    expect(own.atMedian.fits).toBe(true);
    // The p90 laps would need 96.6 L: still under, but close.
    expect(own.atP90.fuelL).toBeCloseTo(23 * 4.2);
    expect(own.atP90.fits).toBe(true);
  });

  it('shows what is left on the p90 load when he runs the median', () => {
    const [own] = planRace(sprint, history).loadToFinish!;
    const fuelLeft = 23 * 4.2 - 23 * 3.5;
    expect(own.leftAtMedian.fuelL).toBeCloseTo(fuelLeft);
    expect(own.leftAtMedian.fuelLaps).toBeCloseTo(fuelLeft / 3.5);
  });

  it('fits under the caps when the rules give room', () => {
    const p = planRace(
      rules({
        lengthLaps: 10,
        fuelL: 84,
        vePct: 100,
        formationLap: false,
      }),
      history,
    );
    expect(p.atMedian.stops).toBe(0);
    const [only] = p.loadToFinish!;
    expect(only.atMedian).toMatchObject({
      fuelL: 35,
      vePct: 30,
      fits: true,
      limitedBy: 'fuel',
    });
    expect(p.loadToFinish).toHaveLength(1);
  });

  it('works from fuel alone without a VE channel', () => {
    const p = planRace(
      rules({lengthLaps: 10, formationLap: false}),
      laps(10, 3.5, null),
    );
    const [only] = p.loadToFinish!;
    expect(only.atMedian).toMatchObject({
      fuelL: 35,
      vePct: null,
      limitedBy: null,
    });
    expect(only.leftAtMedian.vePct).toBeNull();
  });

  it('is absent without any history', () => {
    expect(planRace(sprint, []).loadToFinish).toBeNull();
  });
});
