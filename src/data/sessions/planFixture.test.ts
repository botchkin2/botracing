// The Plan reads a session only through its plan block now. This is a real LMU
// race (Road Atlanta, 3 Oct 2026; VE, traffic, result) through the real sync
// --local: the block the sync wrote, and the lap docs it was made from. The
// numbers below were checked in the PR that added the block (#428) against the
// plan the app built from the full laps, and are held here.
import {describe, expect, it} from '@jest/globals';

import {fuelOnly, greenLapsOf} from '@/src/features/plan/model';
import {formationBurnOf} from '@/src/features/plan/formation';
import {pitLaneBase} from '@/src/features/plan/pitBase';

import fixture from './__fixtures__/planRace.json';
import {toPlanBlock} from './planBlock';
import {raceFactsOfPlan} from './raceFacts';

const block = toPlanBlock(fixture.plan)!;

describe('a real LMU race through the plan block', () => {
  it('reads the block as the app\'s types, rows and race side intact', () => {
    expect(block.laps).toHaveLength(20);
    expect(block.fuel).toEqual({
      startL: 85,
      fillLimitL: 100,
      tankL: 117,
      litresPerVePct: 0.968,
      litresPerVePctStop: null,
    });
    expect(block.race?.stops).toEqual([]);
  });

  it('gives the planner 20 green laps with VE through the ratio, and median use 2.43 L', () => {
    const laps = greenLapsOf(fixture.session.id, block.laps!, block.fuel.litresPerVePct);
    expect(laps).toHaveLength(20);
    expect(fuelOnly(laps)).toBe(false);
    const fuel = laps.map(l => l.fuelL).sort((a, b) => a - b);
    expect((fuel[9] + fuel[10]) / 2).toBeCloseTo(2.43, 2);
    expect(laps.every(l => l.vePct != null && l.veMeasured)).toBe(true);
    expect(laps.some(l => l.traffic != null)).toBe(true);
  });

  it('gives the race side the comparison reads', () => {
    const facts = raceFactsOfPlan(
      {startedAt: fixture.session.startedAt, plan: block},
      'k',
    );
    expect(facts).toMatchObject({
      limitL: 100,
      startL: 85,
      startVePct: 85,
      raceLaps: 20,
      race: {minutes: 40},
      leftEarly: true,
      playerLapsDone: 21,
      classLeaderLapsDone: 21,
      ownUse: {fuelL: 2.43, vePct: 2.5},
      end: {lapIndex: 21, fuelL: 33.23, vePct: 32.2},
      stops: [],
    });
  });

  it('gives the formation burn the plan measures (3.27 L, one race: an estimate) and no pit base without stops', () => {
    expect(block.race?.formationL).toBe(3.27);
    const burn = formationBurnOf([block.race!.formationL], 2.43);
    expect(burn.kind).toBe('estimate');
    expect(pitLaneBase([block.race!], 'GT3')).toBeNull();
  });
});
