import {type RuleSet} from './ruleSet';
import {describe, expect, it} from '@jest/globals';

import {planRace, type GreenLap} from '@/src/analysis/fuelPlan';
import {
  type PlanLap,
  type PlanSession,
  type SessionFuel,
  type SessionSummary,
} from '@/src/data/sessions';
import {carLabel} from '@/src/design';
import {newPreset} from '@/src/state/fuelPresets';

import {
  carChoices,
  type Combo,
  comboCar,
  columnWidth,
  comboTrack,
  defaultCombo,
  driftRowOf,
  fuelOnly,
  greenLapsOf,
  eventLoad,
  HISTORY_SESSIONS,
  historySessions,
  lastFuelOf,
  limitsOfPlan,
  planCombos,
  parseNumber,
  planView,
  rulesCells,
  rulesFor,
  sessionLimitL,
  startChips,
  trackChoices,
  undrivenPlanKey,
  veRatioFor,
} from './model';

const session = (
  id: string,
  startedAt: string,
  over: Partial<SessionSummary> = {},
): SessionSummary => ({
  id,
  sim: 'lmu',
  trackId: 'lmu-daytona',
  track: 'Daytona',
  car: 'Manthey DK Engineering 2026 #91:LM',
  carClass: 'GT3',
  sessionType: 'R',
  startedAt,
  lapCount: 10,
  comparableCount: 8,
  bestTimeS: 108,
  medianTimeS: 110,
  bestLapId: null,
  series: null,
  classLaps: null,
  finish: null,
  eventId: null,
  online: null,
  endedAt: null,
  cornerMapSource: 'stored',
  updatedAt: startedAt,
  ...over,
});

const sessionFuel = (over: Partial<SessionFuel> = {}): SessionFuel => ({
  startL: null,
  fillLimitL: null,
  tankL: null,
  litresPerVePct: null,
  litresPerVePctStop: null,
  setupVePct: null,
  setupVePerLapPct: null,
  ...over,
});

// A row of the plan block: a green, timed lap with fuel used above zero.
const planLap = (over: Partial<PlanLap> = {}): PlanLap => ({
  n: 1,
  usedL: 3.5,
  veUsedPct: 5,
  timeS: 110,
  comparable: true,
  traffic: null,
  ...over,
});

describe('greenLapsOf', () => {
  it('turns the block rows into the planner laps, VE from the ratio', () => {
    const out = greenLapsOf('s1', [planLap()], 0.7);
    // 3.5 L at 0.7 L per 1 % is 5 % VE.
    expect(out).toEqual([
      {
        fuelL: 3.5,
        vePct: 5,
        lapTimeS: 110,
        sessionId: 's1',
        lapIndex: 1,
        comparable: true,
        veMeasured: true,
      },
    ]);
  });

  it('marks a lap whose own VE was not recorded, even when the ratio gives it a VE', () => {
    const out = greenLapsOf('s1', [planLap({veUsedPct: null}), planLap()], 0.7);
    expect(out.map(l => l.veMeasured)).toEqual([false, true]);
  });

  it('keeps the fuel and drops the VE without a ratio', () => {
    const out = greenLapsOf('s1', [planLap(), planLap()], null);
    expect(out.map(l => [l.fuelL, l.vePct])).toEqual([
      [3.5, null],
      [3.5, null],
    ]);
  });

  it('is empty for a session whose block has no lap rows', () => {
    expect(greenLapsOf('s1', [], 0.7)).toEqual([]);
  });
});

describe('veRatioFor', () => {
  const rules: RuleSet = {
    key: 'wedR',
    sessionIds: ['wedR'],
    newestAt: '2026-10-22T16:39:00Z',
    ratio: {perPctL: 0.625, from: {id: 'wedR', startedAt: '2026-10-22T16:39:00Z', sessionType: 'R', online: null}},
    fromPracticeOnly: false,
    stopRatio: 0.609,
    mostRunL: 73,
  };

  it('takes the ratio of the planned rule set, with the date it was measured', () => {
    expect(veRatioFor(null, rules)).toEqual({
      perPctL: 0.625,
      source: {kind: 'session', startedAt: '2026-10-22T16:39:00Z'},
    });
  });

  it('is not picked by the preset fuel: a 75 L preset still has the VE of the rules (T6)', () => {
    const p75 = newPreset('X', {fuelL: 75}, 'p1', '2026-09-26T00:00:00Z');
    expect(veRatioFor(p75, rules)!.perPctL).toBe(0.625);
  });

  it('prefers the preset ratio', () => {
    const preset = newPreset('X', {veRatio: 0.68}, 'p1', '2026-09-26T00:00:00Z');
    expect(veRatioFor(preset, rules)).toEqual({perPctL: 0.68, source: {kind: 'preset'}});
  });

  it('is null with neither', () => {
    expect(veRatioFor(null, null)).toBeNull();
  });
});

describe('rulesFor', () => {
  const length = {kind: 'min' as const, value: 60};
  const last = sessionFuel({startL: 89, fillLimitL: 84, tankL: 115});

  it('uses the preset fuel first, then fill limit, start fuel and tank', () => {
    const preset = newPreset(
      'Endurance',
      {fuelL: 75},
      'p1',
      '2026-09-26T00:00:00Z',
    );
    expect(rulesFor(preset, length, last)!.rules.fuelL).toBe(75);
    expect(rulesFor(preset, length, last)!.fuelSource).toBe('preset');
    expect(rulesFor(null, length, last)).toMatchObject({
      fuelSource: 'fill limit',
      rules: {fuelL: 84},
    });
    // No setup recorded: what he started with there, not the tank ceiling.
    expect(
      rulesFor(
        null,
        length,
        sessionFuel({startL: 100, fillLimitL: null, tankL: 117}),
      ),
    ).toMatchObject({fuelSource: 'start fuel', rules: {fuelL: 100}});
    expect(
      rulesFor(
        null,
        length,
        sessionFuel({startL: null, fillLimitL: null, tankL: 117}),
      ),
    ).toMatchObject({fuelSource: 'tank', rules: {fuelL: 117}});
  });

  it('cannot plan without any fuel', () => {
    expect(rulesFor(null, length, null)).toBeNull();
    expect(
      rulesFor(
        null,
        length,
        sessionFuel({startL: null, fillLimitL: null, tankL: null}),
      ),
    ).toBeNull();
  });

  it('a preset with its own fuel needs no session', () => {
    const preset = newPreset('X', {fuelL: 75}, 'p1', '2026-09-26T00:00:00Z');
    expect(rulesFor(preset, length, null)!.rules.fuelL).toBe(75);
  });

  it('carries the race length into laps or minutes', () => {
    expect(rulesFor(null, length, last)!.rules).toMatchObject({
      lengthMin: 60,
      lengthLaps: null,
    });
    expect(
      rulesFor(null, {kind: 'laps', value: 40}, last)!.rules,
    ).toMatchObject({lengthMin: null, lengthLaps: 40});
  });

  it('no limits means 100 % VE, a formation lap and no mandatory stop', () => {
    expect(rulesFor(null, length, last)!.rules).toMatchObject({
      name: 'No limits',
      vePct: 100,
      formationLap: true,
      mandatoryStops: 0,
    });
  });
});

describe('planView', () => {
  const history: GreenLap[] = Array.from({length: 10}, (_, i) => ({
    fuelL: 3.5,
    vePct: 5,
    lapTimeS: 110,
    sessionId: i % 2 ? 'a' : 'b',
  }));
  const preset = newPreset(
    'Endurance 75 % fuel',
    {fuelL: 84, length: {kind: 'laps', value: 45}, formationLap: false},
    'p1',
    '2026-09-26T00:00:00Z',
  );
  const rules = rulesFor(preset, preset.length, null)!;
  const ratio = {
    perPctL: 0.7,
    source: {kind: 'session' as const, startedAt: '2026-09-20T10:00:00Z'},
  };
  const view = planView(preset, rules, planRace(rules.rules, history), {
    since: '2026-09-01T10:00:00Z',
    lastFillLimitL: 75,
    ratio,
    lastRatio: 0.7,
    ratioLoadsL: [84],
    drift: null,
  });

  it('names the rules and flags a preset that differs from the last session', () => {
    expect(view.rulesLine).toContain('Endurance 75 % fuel');
    expect(view.rulesLine).toContain('set ');
    expect(view.stale).toBe(
      'max fuel: preset 84 L  ·  last session there 75 L',
    );
  });

  it('names what the per-lap numbers stand on: laps, sessions and since when', () => {
    expect(view.basis.from).toMatch(/^10 laps in 2 sessions, since /);
    expect(view.basis.drift).toBeNull();
  });

  it('prints no ratio note when VE was measured: the rules line names the session', () => {
    expect(view.basis.ratio).toBeNull();
  });

  it('reads a race that needs no stop as a load to finish', () => {
    const short = rulesFor(
      null,
      {kind: 'laps', value: 10},
      sessionFuel({startL: 84, fillLimitL: 84, tankL: null}),
    )!;
    const v = planView(null, short, planRace(short.rules, history), {
      since: null,
      lastFillLimitL: null,
      ratio: null,
      lastRatio: null,
      ratioLoadsL: [],
      drift: null,
    });
    const load = v.loadTable!;
    // 10 laps + the formation's 0.4 laps of fuel (no VE) at 3.5 L and 5 %: 36.40 L, 50.00 % VE.
    expect(load.rows[0].label).toBe('10 laps + form.');
    expect(load.rows[0].median).toContain('36.40 L');
    expect(load.rows[0].median).toContain('50.00 %');
    expect(load.head[2]).toContain('p90');
  });

  it('says why there is no VE when no session ran the preset load', () => {
    const p60 = newPreset('X', {fuelL: 60}, 'p1', '2026-09-26T00:00:00Z');
    const r = rulesFor(p60, p60.length, null)!;
    const v = planView(p60, r, planRace(r.rules, history), {
      since: null,
      lastFillLimitL: 84,
      ratio: null,
      lastRatio: 0.81,
      ratioLoadsL: [84, 100],
      drift: null,
    });
    expect(v.basis.ratio).toBe(
      'no VE: none of your sessions ran 60 L (they ran 84, 100 L) and the ratio follows the load; type it into the preset',
    );
  });

  it('flags a preset ratio that differs from the last session', () => {
    const withRatio = newPreset(
      'X',
      {fuelL: 84, veRatio: 0.6},
      'p1',
      '2026-09-26T00:00:00Z',
    );
    const r = rulesFor(withRatio, withRatio.length, null)!;
    const v = planView(withRatio, r, planRace(r.rules, history), {
      since: null,
      lastFillLimitL: 84,
      ratio: {perPctL: 0.6, source: {kind: 'preset'}},
      lastRatio: 0.7,
      ratioLoadsL: [84],
      drift: null,
    });
    expect(v.stale).toBe(
      'L per 1 % VE: preset 0.600  ·  last session there 0.700',
    );
  });

  it('leaves the stale line out for no limits', () => {
    const noLimits = rulesFor(
      null,
      {kind: 'laps', value: 45},
      sessionFuel({startL: 84, fillLimitL: 84, tankL: null}),
    )!;
    const v = planView(null, noLimits, planRace(noLimits.rules, history), {
      since: null,
      lastFillLimitL: 84,
      ratio: null,
      lastRatio: null,
      ratioLoadsL: [],
      drift: null,
    });
    expect(v.stale).toBeNull();
    expect(v.rulesLine).toBe('Rules: last race here (84 L fill limit)');
  });

  it('shows no data without history', () => {
    const empty = planView(preset, rules, planRace(rules.rules, []), {
      since: null,
      lastFillLimitL: null,
      ratio: null,
      lastRatio: null,
      ratioLoadsL: [],
      drift: null,
    });
    expect(empty.basis.from).toBe('0 laps in 0 sessions');
    expect(empty.loadTable).toBeNull();
  });
});

describe('parseNumber', () => {
  it('reads positive numbers, with a comma or a point', () => {
    expect(parseNumber('75')).toBe(75);
    expect(parseNumber(' 2.5 ')).toBe(2.5);
    expect(parseNumber('2,5')).toBe(2.5);
  });

  it('refuses empty, zero, negative and text', () => {
    for (const bad of ['', ' ', '0', '-3', 'abc', '1e999', '7.7.7'])
      expect(parseNumber(bad)).toBeNull();
  });
});

describe('sessionLimitL', () => {
  it('reads the limit as rulesFor does: limit, else start fuel, else tank', () => {
    const f = (o: Partial<SessionFuel>) => ({
      startL: null,
      fillLimitL: null,
      tankL: null,
      litresPerVePct: null,
      litresPerVePctStop: null,
      setupVePct: null,
      setupVePerLapPct: null,
      ...o,
    });
    expect(sessionLimitL(f({fillLimitL: 75, startL: 60, tankL: 117}))).toBe(75);
    expect(sessionLimitL(f({startL: 60, tankL: 117}))).toBe(60);
    expect(sessionLimitL(f({tankL: 117}))).toBe(117);
    expect(sessionLimitL(f({}))).toBeNull();
    expect(sessionLimitL(null)).toBeNull();
  });
});

describe('driftRowOf', () => {
  it('names both meters and how much history the plan kept', () => {
    const row = driftRowOf({
      fuelL: {newest: 2.88, history: 2.31},
      vePct: {newest: 4.3, history: 3.33},
      direction: 'more',
      applied: true,
      keptSessions: 3,
      keptLaps: 15,
      droppedSessions: 21,
    });
    expect(row.label).toBe('Newest session');
    expect(row.value).toBe(
      '2.88 L a lap against 2.31 L\n4.30 %/lap against 3.33 %',
    );
    expect(row.note).toBe(
      'differs from 23 other sessions · plan uses the last 15 laps (3 sessions)',
    );
  });

  it('leaves out a meter that did not move', () => {
    const row = driftRowOf({
      fuelL: null,
      vePct: {newest: 4.3, history: 3.33},
      direction: 'more',
      applied: true,
      keptSessions: 1,
      keptLaps: 6,
      droppedSessions: 1,
    });
    expect(row.value).toBe('4.30 %/lap against 3.33 %');
    expect(row.note).toContain('1 other session ·');
    expect(row.note).toContain('the last 6 laps (1 session)');
  });

  it('says a lower session is not used, and what switches it', () => {
    const row = driftRowOf({
      fuelL: {newest: 2.1, history: 2.4},
      vePct: null,
      direction: 'less',
      applied: false,
      keptSessions: 5,
      keptLaps: 80,
      droppedSessions: 0,
    });
    expect(row.value).toBe('2.10 L a lap against 2.40 L');
    expect(row.note).toBe(
      'lower than 4 other sessions · not used until a second session agrees',
    );
  });
});

describe('fuelOnly', () => {
  const lap = (veMeasured: boolean): GreenLap => ({
    fuelL: 2.4,
    vePct: 3.5,
    lapTimeS: 90,
    sessionId: 's',
    veMeasured,
  });

  it('is fuel-only when there are laps for a median and fewer than 3 carry VE of their own', () => {
    expect(fuelOnly([lap(false), lap(false), lap(false), lap(false)])).toBe(
      true,
    );
    expect(fuelOnly([lap(true), lap(true), lap(false), lap(false)])).toBe(true);
  });

  it('is not fuel-only with too few laps for a median: nothing is known about VE (a Hypercar driven for one lap)', () => {
    expect(fuelOnly([])).toBe(false);
    expect(fuelOnly([lap(false)])).toBe(false);
    expect(fuelOnly([lap(false), lap(false)])).toBe(false);
  });

  it('is not fuel-only from 3 laps with VE, however many have none (Barcelona: March without VE, August with)', () => {
    const mixed = [
      ...Array.from({length: 20}, () => lap(false)),
      ...Array.from({length: 3}, () => lap(true)),
    ];
    expect(fuelOnly(mixed)).toBe(false);
  });
});

describe('an iRacing history: every lap has no VE', () => {
  const lap = (): GreenLap => ({
    fuelL: 2.4,
    vePct: null,
    lapTimeS: 90,
    sessionId: 's',
  });
  const rules = {
    name: 'iRacing 40 min',
    lengthLaps: null,
    lengthMin: 40,
    fuelL: 60,
    vePct: 100,
    formationLap: false,
    mandatoryStops: 0,
  };

  it('is fuel-only, and its rules block has no VE rows', () => {
    const history = Array.from({length: 5}, lap);
    const hasVe = !fuelOnly(history);
    expect(hasVe).toBe(false);
    expect(rulesCells(rules, hasVe, null).map(c => c.label)).toEqual([
      'Max fuel',
      'Mandatory',
      'Formation',
    ]);
  });
});

describe('defaultCombo', () => {
  const combo = (key: string, comparable: number[]): Combo => ({
    key,
    sim: 'lmu',
    trackId: 't',
    track: 't',
    label: key,
    car: 'c',
    sessions: comparable.map((n, i) => ({
      ...session(`${key}${i}`, '2026-09-20T10:00:00Z'),
      comparableCount: n,
    })),
  });

  it('opens on the newest track and car with enough laps for a median, not one driven for a lap', () => {
    const combos = [combo('cadillac', [1]), combo('porsche', [12, 30])];
    expect(defaultCombo(combos)?.key).toBe('porsche');
  });

  it('counts the laps across a combo’s sessions', () => {
    expect(defaultCombo([combo('a', [1, 1, 1])])?.key).toBe('a');
    expect(defaultCombo([combo('a', [1]), combo('b', [2, 1])])?.key).toBe('b');
  });

  it('falls back to the newest when none has enough, and to null with none', () => {
    expect(defaultCombo([combo('a', [1]), combo('b', [0])])?.key).toBe('a');
    expect(defaultCombo([])).toBeNull();
  });
});

describe('limitsOfPlan', () => {
  const row = (fillLimitL: number | null, plan = true) =>
    ({
      id: 's',
      startedAt: '2026-10-09T10:00:00Z',
      sessionType: 'R',
      plan: plan
        ? {
            v: 1,
            fuel: {
              fillLimitL,
              startL: null,
              tankL: null,
              litresPerVePct: null,
              litresPerVePctStop: null,
              setupVePct: null,
              setupVePerLapPct: null,
            },
            laps: null,
            race: null,
          }
        : null,
    } as PlanSession);

  it('is pending while the request is in flight, and a session not listed yet has no limit', () => {
    expect(limitsOfPlan([row(75), undefined], true)).toEqual({
      pending: true,
      limitsL: [75, undefined],
    });
  });

  it('once the request has answered, a session it does not list is no data (null), not loading', () => {
    const state = limitsOfPlan([row(75), undefined], false, true);
    expect(state.limitsL).toEqual([75, null]);
  });

  it('a session missing from the answer counts as a session with no limit in the history', () => {
    const combo = {
      sessions: [
        session('a', '2026-10-09T10:00:00Z'),
        session('b', '2026-10-08T10:00:00Z'),
      ],
    } as Combo;
    const answered = limitsOfPlan([row(75), undefined], false, true).limitsL;
    expect(historySessions(combo, answered).map(s => s.id)).toEqual(['a', 'b']);
    const loading = limitsOfPlan([row(75), undefined], true, false).limitsL;
    expect(historySessions(combo, loading).map(s => s.id)).toEqual(['a']);
  });

  it('is not pending when the request failed: the sessions are left out, not waited for', () => {
    const state = limitsOfPlan([undefined, undefined], false);
    expect(state.pending).toBe(false);
    expect(state.limitsL).toEqual([undefined, undefined]);
  });

  it('reads a session uploaded before the block existed as no limit (null), not as loading', () => {
    expect(limitsOfPlan([row(null, false)], false).limitsL).toEqual([null]);
  });
});

// Road Atlanta 911, thread 44 #1954: every session on record ran a 75 L load
// (2.40 L a lap, 0.675 L per % of VE); the event being planned is a 100 L one,
// where a % of VE is worth 0.968 L. The same fuel a lap reads 2.5 % there, not
// the 3.5 % it read at 75 L, and 40 minutes need no stop.
describe('planning an event with litres pooled from other events', () => {
  const history = Array.from({length: 12}, (_, i) =>
    planLap({n: i + 1, timeS: 81.3, usedL: 2.4, veUsedPct: 3.55}),
  );
  const rules = {
    name: 'test',
    lengthLaps: null,
    lengthMin: 40,
    fuelL: 100,
    vePct: 100,
    formationLap: true,
    mandatoryStops: 0,
  };

  it("with the planned event's own ratio, VE per lap follows the event", () => {
    const ratio = {perPctL: 0.968};
    const plan = planRace(rules, greenLapsOf('s', history, ratio.perPctL));
    expect(plan.perLap.ve!.median).toBeCloseTo(2.4 / 0.968, 6);
    expect(plan.raceLaps!.estimate).toBe(30);
    expect(plan.atMedian.stops).toBe(0);
  });

  it('with no rule set there is no VE yet, and the fuel plan still needs no stop', () => {
    const plan = planRace(rules, greenLapsOf('s', history, null));
    expect(plan.perLap.ve).toBeNull();
    expect(plan.perLap.fuel!.median).toBeCloseTo(2.4, 6);
    expect(plan.atMedian.stops).toBe(0);
  });
});

describe('an older event keeps its own sessions in the history', () => {
  it('adds the event sessions to the newest eight, however old', () => {
    const many = Array.from({length: HISTORY_SESSIONS + 3}, (_, i) =>
      session(`s${i}`, `2026-09-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
    );
    const [combo] = planCombos(many);
    const limits = combo.sessions.map(() => 75);
    const ids = historySessions(combo, limits, ['s0', 's1']).map(s => s.id);
    expect(ids).toHaveLength(HISTORY_SESSIONS + 2);
    expect(ids).toContain('s0');
    expect(ids).toContain('s1');
    // Still a session doc that is loading is not used yet.
    limits[combo.sessions.findIndex(s => s.id === 's0')] = undefined as never;
    expect(historySessions(combo, limits, ['s0']).map(s => s.id)).not.toContain(
      's0',
    );
  });
});

describe('eventLoad', () => {
  const f = (over: Partial<SessionFuel>) =>
    ({fillLimitL: null, startL: null, tankL: null, ...over} as SessionFuel);

  it('is the largest fill limit over the event, never a Q or R start under it', () => {
    expect(
      eventLoad([
        f({fillLimitL: 100, startL: 87}),
        f({fillLimitL: 100, startL: 28}),
      ]),
    ).toEqual({kind: 'fill limit', litres: 100});
  });

  it('falls back to the largest start, then the tank, when no setup level was recorded', () => {
    expect(eventLoad([f({startL: 28}), f({startL: 87})])).toEqual({
      kind: 'start fuel',
      litres: 87,
    });
    expect(eventLoad([f({tankL: 117}), null])).toEqual({
      kind: 'tank',
      litres: 117,
    });
    expect(eventLoad([null, undefined])).toBeNull();
  });
});

describe('undrivenPlanKey', () => {
  it('opens an undriven track with the car of his newest LMU session', () => {
    const old = session('a', '2026-09-01T10:00:00Z', {
      car: 'Ferrari 296 GT3 #21:LM',
    });
    const newest = session('b', '2026-10-09T10:00:00Z');
    const iracing = session('c', '2026-10-10T10:00:00Z', {sim: 'iracing'});
    const empty = session('d', '2026-10-11T10:00:00Z', {lapCount: 0});
    expect(undrivenPlanKey('lmu-spa', [old, newest, iracing, empty])).toBe(
      `lmu-spa|${carLabel(newest.car).model}`,
    );
  });

  it('is null with no LMU session to take a car from', () => {
    expect(undrivenPlanKey('lmu-spa', [])).toBeNull();
    expect(
      undrivenPlanKey('lmu-spa', [
        session('c', '2026-10-10T10:00:00Z', {sim: 'iracing'}),
      ]),
    ).toBeNull();
  });
});

describe('a stored preset VE % is kept but not applied (thread 104)', () => {
  it('rulesFor plans on a full VE load whatever the preset holds', () => {
    const old = newPreset('Old', {vePct: 80}, 'p1', '2026-09-26T00:00:00Z');
    expect(old.vePct).toBe(80);
    const rules = rulesFor({...old, fuelL: 75}, {kind: 'min', value: 60}, null)!;
    expect(rules.rules.vePct).toBe(100);
    // the stored preset is untouched
    expect(old.vePct).toBe(80);
  });
});

describe('under a rule set the tank is never the load (thread 104)', () => {
  // A live online practice: the capture reports the car's own 117 L tank, no fill limit, a start of 78.9 L.
  const livePractice = {startL: 78.9, fillLimitL: null, tankL: 117, litresPerVePct: 0.839, litresPerVePctStop: null, setupVePct: null, setupVePerLapPct: null};
  const length = {kind: 'min' as const, value: 60};
  const laps: GreenLap[] = Array.from({length: 10}, () => ({fuelL: 3.6, vePct: 4.3, lapTimeS: 123, sessionId: 's'}));

  it('a rule set made of one live practice has no load: not 117 L, not the practice start', () => {
    const last = lastFuelOf(livePractice, null, true)!;
    expect(last).toMatchObject({fillLimitL: null, startL: null, tankL: null});
    expect(rulesFor(null, length, last)).toBeNull();
  });

  it('a VE car with no load known plans on VE alone, labelled, with no litres shown (thread 104)', () => {
    const last = lastFuelOf(livePractice, null, true)!;
    // 100 x its ratio is what VE allows; the plan uses a load that never limits
    const rules = rulesFor(null, length, last, {}, true)!;
    expect(rules.fuelSource).toBe('unknown');
    expect(rules.rules.fuelL).toBeNull();
    const plan = planRace(rules.rules, laps);
    const view = planView(null, rules, plan, {
      since: null,
      lastFillLimitL: null,
      eventText: 'Rules from your practice, Oct 21',
      ruleSet: true,
      ratio: null,
      lastRatio: null,
      ratioLoadsL: [],
      drift: null,
    });
    expect(view.rulesLine).toBe('Rules from your practice, Oct 21');
    expect(view.rulesLine).not.toMatch(/117|83\.9|167|125/);
    // no Max fuel cell, no litres anywhere in the rules cells
    expect(rulesCells(rules.rules, true, 0.839).map(c => c.label)).not.toContain('Max fuel');
  });

  it('a fuel-only car (no ratio, so no VE allowance) with no load still needs fuel', () => {
    const last = lastFuelOf({...livePractice, litresPerVePct: null}, null, false)!;
    expect(rulesFor(null, length, {...last, startL: null, tankL: null}, {}, false)).toBeNull();
  });

  it('a rule set with a most-run load plans on it, and the line does not print the 117 L tank', () => {
    const last = lastFuelOf(livePractice, {kind: 'fill limit', litres: 85}, true)!;
    const rules = rulesFor(null, length, last)!;
    expect(rules.rules.fuelL).toBe(85);
    const view = planView(null, rules, planRace(rules.rules, laps), {
      since: null,
      lastFillLimitL: 85,
      eventText: 'Rules from your race, Oct 21',
      ruleSet: true,
      ratio: null,
      lastRatio: null,
      ratioLoadsL: [],
      drift: null,
    });
    expect(view.rulesLine).toBe('Rules from your race, Oct 21');
  });

  it('a series week of a car with no VE keeps its old reading of the load', () => {
    const last = lastFuelOf(livePractice, {kind: 'start fuel', litres: 80}, false)!;
    expect(last).toMatchObject({fillLimitL: null, startL: 80, tankL: 117});
  });
});

describe('columnWidth', () => {
  it('is the content plus both paddings: a 375 pt phone gives its cards 343 pt, so charts drawn to 343 fit', () => {
    expect(columnWidth(343, 16)).toBe(375);
    expect(columnWidth(1100, 16)).toBe(1132);
  });
});
