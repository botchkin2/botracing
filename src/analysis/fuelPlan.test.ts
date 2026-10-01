import {describe, expect, it} from '@jest/globals';

import {
  type GreenLap,
  MIN_COMPARE_LAPS,
  planRace,
  presetMismatch,
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
    expect(p.raceLaps).toEqual({estimate: 33, oneMore: 34});
  });

  it('bounds the late flag by the leader pace when class timing has it', () => {
    // 3630 s at 110 s is 33.0, so 33 laps. A leader at 100 s takes the flag at
    // 3700 s, which is lap 33.6 for him: 34.
    const rule = rules({lengthLaps: null, lengthMin: 60.5});
    const at100 = planRace(rule, laps(10, 3.5, 5, 110), 100);
    expect(at100.raceLaps).toEqual({estimate: 33, oneMore: 34});
    // 3600 s: the leader at 98 s crosses at 3626 s, which is lap 33.0 for him: no extra lap.
    const none = planRace(
      rules({lengthLaps: null, lengthMin: 60}),
      laps(10, 3.5, 5, 110),
      98,
    );
    expect(none.raceLaps).toEqual({estimate: 33, oneMore: null});
  });

  it('a race in laps has no one-more', () => {
    const p = planRace(rules({lengthLaps: 40}), laps(10, 3.5, 5));
    expect(p.raceLaps).toEqual({estimate: 40, oneMore: null});
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
    expect(p.raceLaps).toEqual({estimate: 22, oneMore: 23});
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
