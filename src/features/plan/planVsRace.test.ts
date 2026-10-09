import {describe, expect, it} from '@jest/globals';

import type {RaceFacts} from '@/src/analysis/fuelPlan';

import {dateOf, plural, raceRules} from './planVsRace';

const facts = (over: Partial<RaceFacts> = {}): RaceFacts => ({
  planKey: 't|c',
  startedAt: '2026-09-26T00:38:00Z',
  limitL: 75,
  startL: 75,
  raceLaps: 30,
  race: {kind: 'laps', laps: 30},
  ownUse: {fuelL: 2.4, vePct: 3.5},
  stops: [{lapIndex: 19, fuelL: 12.9, vePct: 0}],
  end: {lapIndex: 30, fuelL: 13.1, vePct: 5},
  ...over,
});

describe('raceRules', () => {
  it('gives the planner this race: its fill limit, a full VE load, a formation lap, its lap count', () => {
    expect(raceRules(facts())).toEqual({
      name: 'This race',
      lengthLaps: 30,
      lengthMin: null,
      fuelL: 75,
      vePct: 100,
      formationLap: true,
      mandatoryStops: 0,
    });
  });

  it('plans a timed race by its minutes, not by the laps this driver completed', () => {
    // The 3 Oct Road Atlanta race: 40 minutes, 21 laps completed.
    const rules = raceRules(
      facts({race: {kind: 'timed', minutes: 40}, raceLaps: 20}),
    );
    expect(rules).toMatchObject({lengthMin: 40, lengthLaps: null});
  });

  it('has no rules without a fill limit or without a known length', () => {
    expect(raceRules(facts({limitL: null}))).toBeNull();
    expect(raceRules(facts({race: null}))).toBeNull();
  });
});

describe('the words the plan half prints', () => {
  it('names a date by hand, day then month', () => {
    expect(dateOf('2026-09-26T00:38:00Z')).toBe('26 Sep');
  });

  it('pluralises a count', () => {
    expect(plural(1, 'lap')).toBe('1 lap');
    expect(plural(12, 'green lap')).toBe('12 green laps');
  });
});
