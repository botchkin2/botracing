// The uploader's `plan` block (tools/sessions/planBlock.mjs) must carry the
// same numbers the app reads off the full lap docs today. The fixture is a real
// LMU race (Road Atlanta, 3 Oct 2026) through the real sync --local: the lap
// docs the Plan reads, the session's own fields, and the block that sync wrote.
// The part (c) switch to the block must keep these equal.
import {describe, expect, it} from '@jest/globals';

import {greenLapsOf, veRatioOf} from '@/src/features/plan/model';

import {toFinishPlace, toLaps} from './adapters';
import {raceFacts} from './raceFacts';
import fixture from './__fixtures__/planRace.json';

type PlanLap = (typeof fixture.plan.laps)[number];

// What the app would build from the block: the same GreenLap the lap docs give.
function greenLapsOfBlock(
  sessionId: string,
  laps: PlanLap[],
  ratio: number | null,
) {
  return laps.map(l => ({
    fuelL: l.usedL,
    vePct: ratio != null && ratio > 0 ? l.usedL / ratio : null,
    lapTimeS: l.timeS,
    sessionId,
    comparable: l.comparable,
    veMeasured: l.veUsedPct != null && l.veUsedPct > 0,
    traffic: l.traffic
      ? {
          trafficAheadS: l.traffic.aheadS,
          passesSufferedAll: l.traffic.passes,
          blueFlagS: l.traffic.blueS,
          battleS: l.traffic.battleS,
          overtakes: Array.from({length: l.traffic.overtakes}),
        }
      : null,
  }));
}

describe('the plan block of a real LMU race against its full laps', () => {
  const laps = toLaps(fixture.laps as unknown as Record<string, unknown>[]);
  const ratio = fixture.plan.fuel.litresPerVePct;

  it('has the green laps the planner reads, with the same numbers', () => {
    const fromLaps = greenLapsOf(fixture.session.id, laps, ratio).map(g => ({
      ...g,
      traffic: g.traffic && {...g.traffic, overtakes: g.traffic.overtakes.length},
    }));
    const fromBlock = greenLapsOfBlock(
      fixture.session.id,
      fixture.plan.laps,
      ratio,
    ).map(g => ({
      ...g,
      traffic: g.traffic && {...g.traffic, overtakes: g.traffic.overtakes.length},
    }));
    expect(fromBlock.length).toBeGreaterThan(10);
    expect(fromBlock).toEqual(fromLaps);
  });

  it('measures the VE ratio the same way: the uploader\'s value is the one in the block', () => {
    expect(veRatioOf(laps)).toBeCloseTo(fixture.plan.fuel.litresPerVePct, 1);
  });

  it('has the race side raceFacts reads: ending lap, formation burn, own use, start VE, laps', () => {
    const facts = raceFacts(
      {
        sessionType: 'R',
        fuel: fixture.session.fuel as never,
        startedAt: fixture.session.startedAt,
        finish: toFinishPlace(fixture.session.result),
        race: fixture.session.race as never,
      },
      'key',
      laps,
    );
    const race = fixture.plan.race!;
    expect(facts).not.toBeNull();
    expect(race.raceLaps).toBe(facts!.raceLaps);
    expect(race.minutes).toBe(facts!.race?.minutes);
    expect(race.leftEarly).toBe(facts!.leftEarly);
    expect(race.playerLapsDone).toBe(facts!.playerLapsDone);
    expect(race.classLeaderLapsDone).toBe(facts!.classLeaderLapsDone);
    expect(race.startVePct).toBe(facts!.startVePct);
    expect(race.ownUse).toEqual(facts!.ownUse);
    expect(race.end).toEqual(facts!.end);
    expect(race.stops).toEqual(facts!.stops);
    // The block's fuel facts are the limits raceFacts and the plan read.
    expect(fixture.plan.fuel.fillLimitL).toBe(facts!.limitL);
    expect(fixture.plan.fuel.startL).toBe(facts!.startL);
  });

  it('has the formation burn the plan measures: the first lap\'s use', () => {
    const first = [...laps].sort((a, b) => a.lapIndex - b.lapIndex)[0];
    expect(fixture.plan.race!.formationL).toBe(first.fuel!.usedL);
  });
});
