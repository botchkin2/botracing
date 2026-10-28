import {describe, expect, it} from '@jest/globals';

import {toLaps} from '@/src/data/sessions/adapters';
import type {Lap, SessionDetail} from '@/src/data/sessions';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {
  buildFuelUse,
  limitText,
  planLinkText,
  planMatchesLimit,
  planRaceText,
  raceLaps,
} from './fuelUse';

const base = toLaps([fixture.laps[0]])[0];
const session = (
  over: Partial<Pick<SessionDetail, 'sessionType' | 'fuel' | 'plan'>> = {},
): Pick<SessionDetail, 'sessionType' | 'fuel' | 'plan'> => ({
  sessionType: 'P',
  plan: null,
  fuel: {
    startL: 75,
    fillLimitL: 75,
    tankL: 75,
    litresPerVePct: 0.68,
    litresPerVePctStop: null,
    setupVePct: null,
    setupVePerLapPct: null,
  },
  ...over,
});

let n = 0;
const lap = (
  stint: number,
  fuelL: number,
  timeS: number,
  over: Partial<Lap> = {},
): Lap => {
  n++;
  return {
    ...base,
    id: `l${n}`,
    lapIndex: n,
    stint,
    timeS,
    comparable: true,
    traffic: null,
    fuel: {
      startL: 0,
      endL: 0,
      usedL: fuelL,
      addedL: 0,
      veStartPct: 0,
      veEndPct: 0,
      veUsedPct: fuelL / 0.68,
      veAddedPct: 0,
      lapsLeftFuel: null,
      lapsLeftVe: null,
      green: true,
    },
    ...over,
  };
};
const stintOf = (
  stint: number,
  use: number[],
  timeS = 81,
  over: Partial<Lap> = {},
) => use.map(u => lap(stint, u, timeS, over));

describe('buildFuelUse', () => {
  it('is for practice and race, never qualifying', () => {
    const laps = stintOf(1, [2.4, 2.41, 2.39, 2.4]);
    expect(buildFuelUse(session({sessionType: 'Q'}), laps)).toBeNull();
    expect(buildFuelUse(session({sessionType: 'P'}), laps)?.race).toBe(false);
    expect(buildFuelUse(session({sessionType: 'R'}), laps)?.race).toBe(true);
  });

  it('a race stint reads against stint 1: signed deltas, in litres and VE', () => {
    // Silverstone 10-15 shape (thread 73): about -0.18 L/lap, -0.25 % VE/lap, -0.14 s.
    const laps = [
      ...stintOf(1, [3.47, 3.45, 3.5, 3.48, 3.46, 3.47], 121.56),
      ...stintOf(2, [3.29, 3.27, 3.31, 3.3, 3.28, 3.29], 121.42),
    ];
    const fu = buildFuelUse(session({sessionType: 'R'}), laps)!;
    expect(fu.stints[0].vsFirst).toBeNull();
    const v = fu.stints[1].vsFirst!;
    expect(v.against).toBe(1);
    expect(v.fuelL).toBeCloseTo(-0.18, 2);
    expect(v.timeS).toBeCloseTo(-0.14, 2);
    expect(v.vePct).toBeCloseTo(-0.26, 2);
    // The plan's race length is the plan card's, not this one's.
    expect(
      planRaceText(fu, {kind: 'min', value: 60}, '60 min', null),
    ).toBeNull();
  });

  it('shows the coast seconds per lap per stint and against stint 1 (his race 32c9d386: about 10 s, then about 17 s)', () => {
    const coasting = (laps: Lap[], s: number[]) =>
      laps.map((l, i) => ({...l, coastS: s[i]}));
    const laps = [
      ...coasting(
        stintOf(1, [3.47, 3.45, 3.5, 3.48, 3.46, 3.47], 121.56),
        [9.8, 10.1, 10.4, 10.4, 10.9, 13],
      ),
      ...coasting(
        stintOf(2, [3.29, 3.27, 3.31, 3.3, 3.28, 3.29], 121.42),
        [12.3, 15, 16.5, 17, 19.2, 21.7],
      ),
    ];
    const fu = buildFuelUse(session({sessionType: 'R'}), laps)!;
    expect(fu.stints.map(s => s.medianCoastS)).toEqual([10.4, 16.75]);
    expect(fu.stints[1].vsFirst!.coastS).toBeCloseTo(6.35, 5);
  });

  it('gives no coast figure when the laps carry none (a session from before the resync)', () => {
    const laps = [
      ...stintOf(1, [3.47, 3.45, 3.5], 121.5),
      ...stintOf(2, [3.29, 3.27, 3.31], 121.4),
    ];
    const fu = buildFuelUse(session({sessionType: 'R'}), laps)!;
    expect(fu.stints.map(s => s.medianCoastS)).toEqual([null, null]);
    expect(fu.stints[1].vsFirst!.coastS).toBeNull();
  });

  it('is null with no green lap', () => {
    const laps = stintOf(1, [2.4, 2.4, 2.4, 2.4]).map(l => ({
      ...l,
      fuel: {...l.fuel!, green: false},
    }));
    expect(buildFuelUse(session(), laps)).toBeNull();
  });

  it('counts in VE when the laps carry it, in litres when they do not', () => {
    const laps = stintOf(1, [2.4, 2.41, 2.39, 2.4]);
    expect(buildFuelUse(session(), laps)!.unit).toBe('ve');
    const fuelOnly = laps.map(l => ({
      ...l,
      fuel: {...l.fuel!, veUsedPct: null},
    }));
    const fu = buildFuelUse(session(), fuelOnly)!;
    expect(fu.unit).toBe('fuel');
    expect(fu.stints[0].medianVePct).toBeNull();
  });

  it('keeps a towed lap in the medians: a tow is a fact about the lap, not a reason to drop it', () => {
    const towed = lap(1, 2.1, 79, {
      traffic: {
        draftS: 8,
        trafficAheadS: 0,
        trafficBehindS: 0,
        blueFlagS: 0,
        passesMade: 0,
        passesSuffered: 0,
        passesMadeAll: 0,
        passesSufferedAll: 0,
        battleS: 0,
        overtakes: [],
        aheadSpans: [],
        blueSpans: [],
        draftSpans: [],
        passMarks: [],
        fieldLapM: null,
      },
    });
    const fu = buildFuelUse(session(), [
      ...stintOf(1, [2.4, 2.41, 2.39, 2.4]),
      towed,
    ])!;
    expect(fu.stints[0].laps).toBe(5);
    expect(fu.stints[0].medianFuelL).toBeCloseTo(2.4, 2);
    expect(fu.stints[0].medianTimeS).toBe(81);
  });

  it('gives no median under 3 laps (the Planner floor)', () => {
    const fu = buildFuelUse(session(), stintOf(1, [2.4, 2.41]))!;
    expect(fu.stints[0].medianFuelL).toBeNull();
    expect(fu.stints[0].vsFirst).toBeNull();
  });

  it('does not read start fuel or the tank as a fill limit (Sarthe qualifying, 31.8 L)', () => {
    const fu = buildFuelUse(
      session({
        fuel: {
          startL: 31.8,
          fillLimitL: null,
          tankL: 75,
          litresPerVePct: null,
          litresPerVePctStop: null,
          setupVePct: null,
          setupVePerLapPct: null,
        },
      }),
      stintOf(1, [2.4, 2.41, 2.39, 2.4]),
    )!;
    expect(fu.limitL).toBeNull();
    expect(limitText(fu)).toBeNull();
  });
});

describe('the plan line', () => {
  it('turns a race length in minutes into laps through the lap time', () => {
    expect(raceLaps({kind: 'min', value: 30}, 81)).toBeCloseTo(22.2, 1);
    expect(raceLaps({kind: 'laps', value: 20}, 81)).toBe(20);
    expect(raceLaps({kind: 'min', value: 30}, null)).toBeNull();
  });

  it('only sets the plan beside a session at the same fill limit', () => {
    expect(planMatchesLimit(75, 75)).toBe(true);
    expect(planMatchesLimit(75, 79)).toBe(false);
    expect(planMatchesLimit(null, 75)).toBe(false);
    expect(planMatchesLimit(75, null)).toBe(false);
  });
});

describe('planLinkText', () => {
  it('says whether the laps are in the plan', () => {
    expect(planLinkText(12, 'Road Atlanta · 911 GT3 R', 75, null)).toBe(
      '12 green laps in Road Atlanta · 911 GT3 R ›',
    );
    expect(planLinkText(12, 'Road Atlanta · 911 GT3 R', 75, 79)).toBe(
      '12 green laps: not in Road Atlanta · 911 GT3 R (79 L). This session ran at the 75 L limit ›',
    );
    expect(planLinkText(12, 'X', null, 79)).toBe(
      '12 green laps: not in X (79 L) ›',
    );
  });
});
