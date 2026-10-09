import {describe, expect, it} from '@jest/globals';

import {type GreenLap, planRace, type RaceFacts} from '@/src/analysis/fuelPlan';

import type {ActualStop} from '@/src/features/session/pitCard';

import {buildPlanHalf} from './planHalf';
import {raceRules} from './planVsRace';

const facts = (over: Partial<RaceFacts> = {}): RaceFacts => ({
  planKey: 't|c',
  startedAt: '2026-09-26T00:38:00Z',
  limitL: 75,
  startL: 75,
  raceLaps: 60,
  race: {kind: 'laps', laps: 60},
  ownUse: {fuelL: 2.4, vePct: 3.5},
  stops: [],
  end: null,
  ...over,
});

// 12 green laps: 2.4 L and 3.5 % VE a lap (litres over 0.686 L per %). At that
// use the planner's full-tank stint is 27 racing laps, then 28 (checked by
// running planRace): a 60 lap race stops after racing laps 27 and 55.
const history = (withVe = true): GreenLap[] =>
  Array.from({length: 12}, (_, i) => {
    const fuelL = 2.4 + (i % 2 ? 0.02 : -0.02);
    return {
      fuelL,
      vePct: withVe ? fuelL / 0.686 : null,
      lapTimeS: 81,
      sessionId: 's',
    };
  });
const basis = {laps: 12, sessions: 2, since: '2026-09-15T00:00:00Z'};

const actual = (lapIndex: number, vePct = 4): ActualStop => ({
  lapIndex,
  fuelL: 9.4,
  vePct,
  lapsLeft: 1.1,
});
const end = {fuelL: 3.7, vePct: 4, lapsLeft: 1.1};

const USE = [
  {k: 'Fuel a lap', p: '2.40 L', a: '2.40 L'},
  {k: 'VE a lap', p: '3.5 %', a: '3.5 %'},
];

function half(
  over: Partial<RaceFacts> = {},
  stops: ActualStop[] = [],
  hasVe = true,
  hist = history(hasVe),
) {
  const f = facts(over);
  const rules = raceRules(f);
  return buildPlanHalf({
    facts: f,
    plan: rules ? planRace(rules, hist) : null,
    rules,
    basis,
    hasVe,
    stops,
    end,
  });
}

describe('buildPlanHalf', () => {
  it('lines the planned stops up with the made stops, in order, row for row', () => {
    const h = half({}, [actual(24), actual(49)]);
    expect(h.note).toBeNull();
    expect(h.rows).toEqual([
      {k: 'Stop 1', p: 'after L28', a: 'after L24'},
      // 28 laps burned (27 + the formation lap) of 100 % at 3.50 %/lap.
      {k: 'In', p: '2 % VE (0.6 laps)', a: '4 % VE (1.1 laps)'},
      {k: 'Stop 2', p: 'after L56', a: 'after L49'},
      // 28 more laps.
      {k: 'In', p: '2 % VE (0.6 laps)', a: '4 % VE (1.1 laps)'},
      // 5 laps after the last planned stop.
      {k: 'Spare', p: '83 % VE (23.6 laps)', a: '4 % VE (1.1 laps)'},
      ...USE,
    ]);
  });

  it('a planned stop the race did not make reads "—" on the race side, never paired with a near one', () => {
    const h = half({}, [actual(30)]);
    expect(h.rows.filter(r => r.k.startsWith('Stop'))).toEqual([
      {k: 'Stop 1', p: 'after L28', a: 'after L30'},
      {k: 'Stop 2', p: 'after L56', a: '—'},
    ]);
    expect(h.rows[3]).toEqual({k: 'In', p: '2 % VE (0.6 laps)', a: '—'});
  });

  it('a stop the plan did not have reads "—" on the plan side', () => {
    const h = half({raceLaps: 30, race: {kind: 'laps', laps: 30}}, [
      actual(14),
      actual(26),
    ]);
    expect(h.rows.filter(r => r.k.startsWith('Stop'))).toEqual([
      {k: 'Stop 1', p: 'after L28', a: 'after L14'},
      {k: 'Stop 2', p: '—', a: 'after L26'},
    ]);
    expect(h.rows[3]).toEqual({k: 'In', p: '—', a: '4 % VE (1.1 laps)'});
  });

  it('a DNF names the finish against the race that ran, and plans that distance', () => {
    const h = half(
      {
        raceLaps: 40,
        leftEarly: true,
        playerLapsDone: 41,
        leaderLapsDone: 61,
      },
      [actual(24)],
    );
    expect(h.rows[0]).toEqual({k: 'Finish', p: 'L61', a: 'DNF L41'});
    // Scheduled 60 racing laps: two stops, not a 40-lap one-stop.
    expect(h.rows.filter(r => r.k.startsWith('Stop'))).toEqual([
      {k: 'Stop 1', p: 'after L28', a: 'after L24'},
      {k: 'Stop 2', p: 'after L56', a: '—'},
    ]);
  });

  it('with no stop the plan is the one load to the flag', () => {
    const h = half({raceLaps: 20, race: {kind: 'laps', laps: 20}}, []);
    // 20 racing laps and the formation lap: 21 x 3.4985 = 73.5 % used.
    expect(h.rows).toEqual([
      {k: 'Spare', p: '27 % VE (7.6 laps)', a: '4 % VE (1.1 laps)'},
      ...USE,
    ]);
  });

  it('fuel only: litres, never a VE part or a made-up zero', () => {
    const h = half(
      {},
      [{lapIndex: 24, fuelL: 6.2, vePct: null, lapsLeft: 2}],
      false,
    );
    // Without VE the fuel sets the stint: 30 racing laps, so the stop is after L31.
    expect(h.rows[0]).toEqual({k: 'Stop 1', p: 'after L31', a: 'after L24'});
    // 31 laps (30 and the formation lap) x 2.4 L = 74.4 L of the 75 L limit leaves 0.6 L.
    expect(h.rows[1]).toEqual({
      k: 'In',
      p: '0.6 L (0.3 laps)',
      a: '6.2 L (2.0 laps)',
    });
    expect(JSON.stringify(h.rows)).not.toMatch(/VE/);
    // The use a lap is the fuel's alone.
    expect(h.rows.at(-1)).toEqual({k: 'Fuel a lap', p: '2.40 L', a: '2.40 L'});
  });

  it('puts the use a lap the plan is built on beside this race’s own, with no verdict', () => {
    const h = half({ownUse: {fuelL: 2.6, vePct: 3.8}});
    expect(h.rows.slice(-2)).toEqual([
      {k: 'Fuel a lap', p: '2.40 L', a: '2.60 L'},
      {k: 'VE a lap', p: '3.5 %', a: '3.8 %'},
    ]);
    // Under three green laps the race has no median of its own: no row, not a made-up one.
    expect(
      half({ownUse: {fuelL: null, vePct: null}}).rows.some(r =>
        /a lap/.test(r.k),
      ),
    ).toBe(false);
  });

  it('plans a timed race at its own length, not the laps this driver completed', () => {
    // 20 minutes at an 81 s median lap, though only 10 laps were completed.
    const timed = {race: {kind: 'timed' as const, minutes: 20}, raceLaps: 10};
    const e = planRace(raceRules(facts(timed))!, history()).raceLaps!.estimate;
    expect(e).toBeGreaterThan(10);
    const spare = half(timed).rows.find(r => r.k === 'Spare')!;
    // One load, the formation lap and the plan's own laps: 100 − (e + 1) × 3.5.
    expect(spare.p).toContain(`${Math.round(100 - (e + 1) * 3.5)} % VE`);
  });

  it('says so when the race length is not on record', () => {
    const h = half({race: null});
    expect(h.rows).toEqual([]);
    expect(h.note).toBe('No race length on record.');
  });

  it('says why there is no plan instead of inventing one', () => {
    expect(half({limitL: null}).rows).toEqual([]);
    expect(half({limitL: null}).note).toBe(
      'No fill limit on record for this race.',
    );
    const none = buildPlanHalf({
      facts: facts(),
      plan: null,
      rules: raceRules(facts()),
      basis: {laps: 0, sessions: 0, since: null},
      hasVe: true,
      stops: [],
      end,
    });
    expect(none.note).toBe('No earlier laps at the 75 L limit.');
    // History without VE cannot plan a VE-state card.
    expect(half({}, [], true, history(false)).note).toBe(
      'No VE use in the earlier laps.',
    );
  });
});
