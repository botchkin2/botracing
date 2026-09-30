import {describe, expect, it} from '@jest/globals';

import {type GreenLap, planRace, type RaceFacts} from '@/src/analysis/fuelPlan';

import {toLaps} from '@/src/data/sessions/adapters';
import type {Lap} from '@/src/data/sessions';
import fixture from '@/src/features/session/__fixtures__/roadAtlantaRace.json';
import {buildPitReview} from '@/src/features/session/pitReview';
import {raceFacts} from '@/src/features/session/raceFacts';

import {buildPlanVsRace, raceRules} from './planVsRace';

const facts = (over: Partial<RaceFacts> = {}): RaceFacts => ({
  planKey: 't|c',
  startedAt: '2026-09-26T00:38:00Z',
  limitL: 75,
  startL: 75,
  raceLaps: 30,
  ownUse: {fuelL: 2.4, vePct: 3.5},
  stops: [{lapIndex: 19, fuelL: 12.9, vePct: 0}],
  ...over,
});

// 12 green laps: 2.4 L and 3.5 % VE a lap (litres over 0.686 L per %).
const history = (fuelL = 2.4): GreenLap[] =>
  Array.from({length: 12}, (_, i) => ({
    fuelL: fuelL + (i % 2 ? 0.02 : -0.02),
    vePct: (fuelL + (i % 2 ? 0.02 : -0.02)) / 0.686,
    lapTimeS: 81,
    sessionId: 's',
  }));
const basis = {laps: 12, sessions: 2, since: '2026-09-15T00:00:00Z'};

function build(over: Partial<RaceFacts> = {}, hist = history()) {
  const f = facts(over);
  const rules = raceRules(f);
  return buildPlanVsRace(f, rules ? planRace(rules, hist) : null, basis);
}

describe('raceRules', () => {
  it('gives the planner this race: its fill limit, a full VE load, a formation lap, the laps driven', () => {
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

  it('has no rules without a fill limit', () => {
    expect(raceRules(facts({limitL: null}))).toBeNull();
  });
});

describe('buildPlanVsRace', () => {
  it('prints the basis with the lap count it was given, then planned, race and use', () => {
    const {lines} = build();
    expect(lines[0]).toContain('Planned from 12 green laps in 2 sessions');
    expect(lines[0]).toContain('at the 75 L limit, since 15 Sep, for 30 laps.');
    expect(lines[1]).toMatch(/^Planned: 1 stop\. The load reaches L\d+/);
    expect(lines[2]).toBe('Race: 1 stop, at L19 with 0 % VE and 12.9 L left.');
    expect(lines[3]).toMatch(/^Fuel a lap: 2\.40 L planned, 2\.40 L this race/);
  });

  it('shows the use check when the race used more than the history (Barcelona 08-13)', () => {
    const {lines} = build({ownUse: {fuelL: 2.88, vePct: 4.3}});
    expect(lines.join('\n')).toContain(
      'Fuel a lap: 2.40 L planned, 2.88 L this race (+20 %)',
    );
    expect(lines.join('\n')).toContain(
      'VE a lap: 3.5 % planned, 4.3 % this race (+23 %)',
    );
  });

  it('says the plan assumes a full load when the race started part-full', () => {
    expect(build({startL: 70}).lines[0]).toContain(
      'Started with 70 L of 75 L; the plan assumes a full load.',
    );
    expect(build({startL: 75}).lines[0]).not.toContain('Started with');
  });

  it('says there is no plan without earlier laps at the limit, or without a limit', () => {
    const noHistory = buildPlanVsRace(facts(), null, {
      laps: 0,
      sessions: 0,
      since: null,
    });
    expect(noHistory.lines).toEqual([
      'No earlier laps at the 75 L limit, so there is no plan for this race.',
    ]);
    expect(build({limitL: null}).lines).toEqual([
      'No fill limit on record for this race, so there is no plan.',
    ]);
  });

  it('reads a race with no stop', () => {
    expect(build({stops: []}).lines).toContain('Race: no stop.');
  });

  it('has no second person: data is the subject', () => {
    const all = build().lines.join(' ');
    expect(all).not.toMatch(/\byou\b|\byour\b/i);
  });
});

describe('one stop, one number', () => {
  // The pit stops card and this block name a stop with the same lap (camber, #160).
  const base = toLaps([fixture.laps[0]])[0];
  const lap = (lapIndex: number, over: Partial<Lap> = {}): Lap => ({
    ...base,
    id: `l${lapIndex}`,
    lapIndex,
    partial: false,
    timeS: 90,
    pitStop: null,
    fuel: {
      startL: 0,
      endL: 40,
      usedL: 2.4,
      addedL: 0,
      veStartPct: 0,
      veEndPct: 0,
      veUsedPct: 3.5,
      veAddedPct: 0,
      lapsLeftFuel: null,
      lapsLeftVe: null,
      green: true,
    },
    ...over,
  });
  const stopLap = lap(14, {
    pitStop: {
      atEntry: {fuelL: 12.9, vePct: 0},
      added: {fuelL: 50, vePct: 38},
      inPitS: 81,
      lapsLeftAtEntry: {fuel: 3.6, ve: 0},
    },
  });
  const laps = [
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(n => lap(n)),
    stopLap,
    lap(15),
    lap(16),
  ];
  const session = {
    sessionType: 'R' as const,
    startedAt: '2026-09-26T00:38:00Z',
    fuel: {
      startL: 75,
      fillLimitL: 75,
      tankL: 75,
      litresPerVePct: null,
      litresPerVePctStop: null,
    },
  };

  it('titles the stop L14 on the card and says L14 in the block', () => {
    const card = buildPitReview('R', laps)!;
    const f = raceFacts(session, 'k', laps)!;
    expect(card.stops[0].title).toBe('L14 · Stop 1 of 1');
    const block = buildPlanVsRace(f, planRace(raceRules(f)!, history()), basis);
    expect(block.lines.join(' ')).toContain('Race: 1 stop, at L14 with');
  });

  it('names the planned stop in the same numbering: racing lap n is L(n + 1)', () => {
    const f = raceFacts(session, 'k', laps)!;
    // Heavy use, so the 15-lap race needs a stop.
    const plan = planRace(raceRules(f)!, history(5));
    const reached = plan.atMedian.stopLaps[0];
    const line = buildPlanVsRace(f, plan, basis).lines.find(l =>
      l.startsWith('Planned: 1 stop'),
    );
    expect(line).toContain(`The load reaches L${reached + 1}`);
  });
});

describe('the use check and the stop laps read cleanly', () => {
  it('says ±0 % when the change rounds to zero, not a signed zero', () => {
    const {lines} = build({ownUse: {fuelL: 2.401, vePct: 3.5}});
    expect(lines.join(' ')).toContain('(±0 %)');
    expect(lines.join(' ')).not.toContain('−0');
  });

  it('prints one list when the median and p90 use stop on the same laps', () => {
    const f = facts({raceLaps: 30});
    const plan = planRace(raceRules(f)!, history(5));
    const line = buildPlanVsRace(f, plan, basis).lines.find(l =>
      l.startsWith('Planned:'),
    )!;
    if (plan.atMedian.stopLaps.join() === plan.atP90.stopLaps.join())
      expect(line).toContain('at the median and p90 use');
    else expect(line).toContain('at the p90 use');
  });
});
