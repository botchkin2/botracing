import {describe, expect, it} from '@jest/globals';

import {toLaps} from '@/src/data/sessions/adapters';
import type {Lap, SessionDetail} from '@/src/data/sessions';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {
  buildFuelUse,
  fuelUseRows,
  limitText,
  planLinkText,
  planMatchesLimit,
  raceLaps,
  verdictText,
} from './fuelUse';

const base = toLaps([fixture.laps[0]])[0];
const session = (
  over: Partial<Pick<SessionDetail, 'sessionType' | 'fuel'>> = {},
): Pick<SessionDetail, 'sessionType' | 'fuel'> => ({
  sessionType: 'P',
  fuel: {
    startL: 75,
    fillLimitL: 75,
    tankL: 75,
    litresPerVePct: 0.68,
    litresPerVePctStop: null,
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
  it('is only for practice', () => {
    const laps = stintOf(1, [2.4, 2.41, 2.39, 2.4]);
    expect(buildFuelUse(session({sessionType: 'R'}), laps)).toBeNull();
    expect(buildFuelUse(session({sessionType: 'Q'}), laps)).toBeNull();
  });

  it('is null with no green lap', () => {
    const laps = stintOf(1, [2.4, 2.4, 2.4, 2.4]).map(l => ({
      ...l,
      fuel: {...l.fuel!, green: false},
    }));
    expect(buildFuelUse(session(), laps)).toBeNull();
  });

  it('says the stints differ when a saving run is more than the laps inside each vary', () => {
    const laps = [
      ...stintOf(1, [2.4, 2.42, 2.38, 2.41, 2.39, 2.4], 81),
      ...stintOf(2, [2.2, 2.21, 2.19, 2.2, 2.22, 2.18], 82.3),
    ];
    const fu = buildFuelUse(session(), laps)!;
    expect(fu.verdict.kind).toBe('differs');
    expect(fu.stints[1].medianFuelL).toBeCloseTo(2.2, 2);
    // One load: 75 L over 2.2 L a lap.
    expect(fu.stints[1].loadLaps.fuel).toBeCloseTo(34.1, 1);
  });

  it('says the stints do not differ when the laps inside each vary more (Road Atlanta 09-25 shape)', () => {
    const laps = [
      ...stintOf(1, [2.39, 2.46, 2.4, 2.45, 2.41, 2.44], 81),
      ...stintOf(2, [2.4, 2.45, 2.42, 2.39, 2.46, 2.43], 81.4),
    ];
    const fu = buildFuelUse(session(), laps)!;
    expect(fu.verdict.kind).toBe('same');
    expect(verdictText(fu)).toContain('Same use');
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

  it('gives no median under 4 laps, and says there is nothing to compare', () => {
    const fu = buildFuelUse(session(), stintOf(1, [2.4, 2.41, 2.39]))!;
    expect(fu.stints[0].medianFuelL).toBeNull();
    expect(fu.verdict.kind).toBe('none');
    expect(fuelUseRows(fu)[0].lines[0]).toContain('no median');
  });

  it('is one stint when only one has enough laps', () => {
    const laps = [
      ...stintOf(1, [2.4, 2.41, 2.39, 2.4]),
      ...stintOf(2, [2.2, 2.2]),
    ];
    expect(buildFuelUse(session(), laps)!.verdict.kind).toBe('one-stint');
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
        },
      }),
      stintOf(1, [2.4, 2.41, 2.39, 2.4]),
    )!;
    expect(fu.limitL).toBeNull();
    expect(fu.stints[0].loadLaps.fuel).toBeNull();
    // 100 % VE is the full load whatever the start.
    expect(fu.stints[0].loadLaps.ve).not.toBeNull();
    expect(limitText(fu)).toContain('No fill limit on record');
  });

  it('has no load in laps of fuel without a fill limit on record', () => {
    const fu = buildFuelUse(
      session({fuel: null}),
      stintOf(1, [2.4, 2.41, 2.39, 2.4]),
    )!;
    expect(fu.limitL).toBeNull();
    expect(fu.stints[0].loadLaps.fuel).toBeNull();
  });

  it('writes a stint as its laps, use, VE, lap time and the load', () => {
    const fu = buildFuelUse(session(), stintOf(1, [2.4, 2.4, 2.4, 2.4], 81.5))!;
    expect(fuelUseRows(fu)[0]).toEqual({
      key: '1',
      title: 'Stint 1 · 4 laps',
      lines: [
        '2.40 L/lap (spread 0.00) · 3.5 % VE/lap · 1:21.500',
        'One load: 31.3 laps of fuel · 28.3 laps of VE',
      ],
      counts: true,
    });
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
    expect(planLinkText(12, 'Road Atlanta · 911 GT3 R', 75, null)).toContain(
      '12 green laps in Road Atlanta · 911 GT3 R ›',
    );
    expect(planLinkText(12, 'Road Atlanta · 911 GT3 R', 75, 79)).toContain(
      '12 green laps: not in Road Atlanta · 911 GT3 R (79 L) ›',
    );
    expect(planLinkText(12, 'X', null, 79)).toContain('12 green laps');
  });
});
