import {describe, expect, it} from '@jest/globals';

import {planRace, type GreenLap} from '@/src/analysis/fuelPlan';
import {type Lap, type LapFuel, type SessionSummary} from '@/src/data/sessions';
import {newPreset} from '@/src/state/fuelPresets';

import {
  greenLapsOf,
  HISTORY_SESSIONS,
  historySessions,
  planCombos,
  parseNumber,
  planView,
  rulesFor,
  veRatioFor,
  veRatioOf,
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
  eventId: null,
  cornerMapSource: 'stored',
  updatedAt: startedAt,
  ...over,
});

const fuel = (over: Partial<LapFuel> = {}): LapFuel => ({
  startL: 50,
  endL: 46.5,
  usedL: 3.5,
  addedL: 0,
  veStartPct: 80,
  veEndPct: 75,
  veUsedPct: 5,
  veAddedPct: 0,
  green: true,
  ...over,
});

const lap = (over: Partial<Lap> = {}): Lap =>
  ({
    id: 'l',
    lapIndex: 1,
    lapNumber: 1,
    timeS: 110,
    sectorsS: [],
    stint: 1,
    comparable: true,
    reasons: [],
    pitIn: false,
    pitOut: false,
    partial: false,
    offTrackS: 0,
    hadImpact: false,
    sections: [],
    recordingId: 'r',
    endedInReset: false,
    traffic: null,
    fuel: fuel(),
    ...over,
  } as Lap);

describe('planCombos', () => {
  it('groups by track and car model, not livery, newest combination first', () => {
    const combos = planCombos([
      session('a', '2026-09-01T10:00:00Z'),
      session('b', '2026-09-20T10:00:00Z', {car: 'Iron Dames 2025 #85:LM'}),
      session('c', '2026-09-25T10:00:00Z', {
        trackId: 'lmu-sebring',
        track: 'Sebring',
      }),
      session('d', '2026-09-10T10:00:00Z', {
        car: 'Manthey DK Engineering 2026 #92:LM',
      }),
    ]);
    // Manthey and Iron Dames are the same Porsche model at Daytona.
    expect(
      combos.map(c => [c.track, c.car, c.sessions.map(s => s.id)]),
    ).toEqual([
      ['Sebring', 'Porsche 911 GT3 R', ['c']],
      ['Daytona', 'Porsche 911 GT3 R', ['b', 'd', 'a']],
    ]);
  });

  it('labels a chip with the short track and car, and the layout when two share a name', () => {
    const [plain] = planCombos([session('a', '2026-09-01T10:00:00Z')]);
    expect(plain.label).toBe('Daytona · 911 GT3 R');
    const two = planCombos([
      session('a', '2026-09-01T10:00:00Z', {
        trackId: 'lmu-silverstone_grand_prix_circuit_elms',
        track: 'Silverstone Circuit',
      }),
      session('b', '2026-09-02T10:00:00Z', {
        trackId: 'lmu-silverstone_grand_prix_circuit_wec',
        track: 'Silverstone Circuit',
      }),
    ]);
    expect(two.map(c => c.label)).toEqual([
      'Silverstone WEC · 911 GT3 R',
      'Silverstone ELMS · 911 GT3 R',
    ]);
  });

  it('skips sessions without laps and other sims', () => {
    const combos = planCombos([
      session('a', '2026-09-01T10:00:00Z', {lapCount: 0}),
      session('b', '2026-09-02T10:00:00Z', {sim: 'iracing'}),
    ]);
    expect(combos).toEqual([]);
  });

  it('draws history from the newest sessions only', () => {
    const many = Array.from({length: HISTORY_SESSIONS + 3}, (_, i) =>
      session(`s${i}`, `2026-09-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
    );
    const [combo] = planCombos(many);
    const ids = historySessions(combo).map(s => s.id);
    expect(ids).toHaveLength(HISTORY_SESSIONS);
    expect(ids[0]).toBe(`s${HISTORY_SESSIONS + 2}`);
  });
});

describe('greenLapsOf', () => {
  it('keeps green timed laps with a positive use, VE from the ratio', () => {
    const out = greenLapsOf(
      's1',
      [
        lap(),
        lap({fuel: fuel({green: false})}),
        lap({timeS: null}),
        lap({fuel: null}),
        lap({fuel: fuel({usedL: 0})}),
        lap({fuel: fuel({usedL: null})}),
      ],
      0.7,
    );
    // 3.5 L at 0.7 L per 1 % is 5 % VE.
    expect(out).toEqual([
      {fuelL: 3.5, vePct: 5, lapTimeS: 110, sessionId: 's1'},
    ]);
  });

  it('keeps the fuel and drops the VE without a ratio', () => {
    const out = greenLapsOf('s1', [lap(), lap()], null);
    expect(out.map(l => [l.fuelL, l.vePct])).toEqual([
      [3.5, null],
      [3.5, null],
    ]);
  });
});

describe('veRatioOf', () => {
  it('is the median litres per 1 % VE over the green laps', () => {
    const laps = [
      lap({fuel: fuel({usedL: 3.5, veUsedPct: 5})}), // 0.7
      lap({fuel: fuel({usedL: 3.6, veUsedPct: 5})}), // 0.72
      lap({fuel: fuel({usedL: 3.4, veUsedPct: 5})}), // 0.68
      lap({fuel: fuel({usedL: 9, veUsedPct: 5, green: false})}),
    ];
    expect(veRatioOf(laps)).toBeCloseTo(0.7);
  });

  it('needs three green laps with fuel and VE', () => {
    const one = lap({fuel: fuel({usedL: 3.5, veUsedPct: 5})});
    expect(veRatioOf([one, one])).toBeNull();
    expect(veRatioOf([one, one, one])).toBeCloseTo(0.7);
  });

  it('is null without a green lap that has fuel and VE', () => {
    expect(veRatioOf([])).toBeNull();
    expect(veRatioOf([lap({fuel: fuel({veUsedPct: null})})])).toBeNull();
    expect(veRatioOf([lap({fuel: null})])).toBeNull();
  });
});

describe('veRatioFor', () => {
  const sessions = [
    {startedAt: '2026-09-29T10:00:00Z', ratio: null, fillLimitL: 100},
    {startedAt: '2026-09-20T10:00:00Z', ratio: 0.81, fillLimitL: 84},
    {startedAt: '2026-09-10T10:00:00Z', ratio: 0.68, fillLimitL: 75},
  ];

  it('takes the newest session that has one, with its date', () => {
    expect(veRatioFor(null, sessions)).toEqual({
      perPctL: 0.81,
      source: {kind: 'session', startedAt: '2026-09-20T10:00:00Z'},
    });
  });

  it('with a preset max fuel, takes the newest session that ran that load', () => {
    const p75 = newPreset('X', {fuelL: 75}, 'p1', '2026-09-26T00:00:00Z');
    // The newer 84 L session is skipped: its ratio is for another event.
    expect(veRatioFor(p75, sessions)).toEqual({
      perPctL: 0.68,
      source: {kind: 'session', startedAt: '2026-09-10T10:00:00Z'},
    });
    const p84 = newPreset('X', {fuelL: 84.3}, 'p2', '2026-09-26T00:00:00Z');
    expect(veRatioFor(p84, sessions)!.perPctL).toBe(0.81);
  });

  it('has no ratio when no session ran the preset load', () => {
    const p60 = newPreset('X', {fuelL: 60}, 'p3', '2026-09-26T00:00:00Z');
    expect(veRatioFor(p60, sessions)).toBeNull();
    // A session with no recorded fill limit cannot be matched either.
    expect(
      veRatioFor(p60, [
        {startedAt: '2026-09-20T10:00:00Z', ratio: 0.81, fillLimitL: null},
      ]),
    ).toBeNull();
  });

  it('with no preset max fuel, the newest ratio is right (rules start from that session)', () => {
    const noFuel = newPreset('X', {}, 'p4', '2026-09-26T00:00:00Z');
    expect(veRatioFor(noFuel, sessions)!.perPctL).toBe(0.81);
  });

  it('prefers the preset ratio', () => {
    const preset = newPreset(
      'X',
      {veRatio: 0.68},
      'p1',
      '2026-09-26T00:00:00Z',
    );
    expect(veRatioFor(preset, sessions)).toEqual({
      perPctL: 0.68,
      source: {kind: 'preset'},
    });
  });

  it('is null with neither', () => {
    expect(
      veRatioFor(null, [{startedAt: 'x', ratio: null, fillLimitL: null}]),
    ).toBeNull();
  });
});

describe('rulesFor', () => {
  const length = {kind: 'min' as const, value: 60};
  const last = {startL: 89, fillLimitL: 84, tankL: 115};

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
      rulesFor(null, length, {startL: 100, fillLimitL: null, tankL: 117}),
    ).toMatchObject({fuelSource: 'start fuel', rules: {fuelL: 100}});
    expect(
      rulesFor(null, length, {startL: null, fillLimitL: null, tankL: 117}),
    ).toMatchObject({fuelSource: 'tank', rules: {fuelL: 117}});
  });

  it('cannot plan without any fuel', () => {
    expect(rulesFor(null, length, null)).toBeNull();
    expect(
      rulesFor(null, length, {startL: null, fillLimitL: null, tankL: null}),
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
  });

  it('names the rules and flags a preset that differs from the last session', () => {
    expect(view.rulesLine).toContain('Endurance 75 % fuel');
    expect(view.rulesLine).toContain('set ');
    expect(view.stale).toBe(
      'max fuel: preset 84 L  ·  last session there 75 L',
    );
  });

  it('prints the five cards in order', () => {
    expect(view.cards.map(c => c.key)).toEqual([
      'perLap',
      'tank',
      'race',
      'stops',
      'dropStop',
    ]);
    const perLap = view.cards[0].rows;
    expect(perLap[0].value).toBe('3.50 L  (3.50 L to 3.50 L)');
    expect(perLap[3].value).toContain('10 laps in 2 sessions, since ');
  });

  it('names the limiting meter in the tank card', () => {
    const rows = view.cards[1].rows;
    expect(rows[1].value).toContain('20 laps (VE runs out first)');
    expect(rows[1].value).toContain('fuel 24, VE 20');
  });

  it('prints stops with their laps and the drop-one-stop line', () => {
    const stops = view.cards[3].rows;
    expect(stops[0].value).toBe('2 stops  ·  after lap 20, 40');
    const drop = view.cards[4].rows;
    expect(drop[0].label).toBe('1 stop');
    // Fuel (3.5 L) would still reach at 3.65 L a lap: only VE has to drop.
    expect(drop[0].value).toContain(
      'Fuel: not the limit (3.65 L a lap would still reach)',
    );
    expect(drop[0].value).toContain('VE: at most 4.35 % a lap');
    expect(drop[1].label).toBe('Your laps at <= 4.35 % VE');
    expect(drop[1].value).toBe('no data  (n = 0)');
  });

  it('shows where the VE ratio came from', () => {
    const note = view.cards[0].rows[1].note;
    expect(note).toContain('0.700 L per 1 % VE');
    expect(note).toContain('measured in the session of ');
  });

  it('reads a race that needs no stop as a load to finish', () => {
    const short = rulesFor(
      null,
      {kind: 'laps', value: 10},
      {startL: 84, fillLimitL: 84, tankL: null},
    )!;
    const v = planView(null, short, planRace(short.rules, history), {
      since: null,
      lastFillLimitL: null,
      ratio: null,
      lastRatio: null,
      ratioLoadsL: [],
    });
    expect(v.cards.some(c => c.key === 'stops')).toBe(false);
    const load = v.cards.find(c => c.key === 'load')!;
    // 10 laps + the formation lap at 3.5 L and 5 %: 38.50 L, 55.00 % VE.
    expect(load.rows[0].label).toBe('10 laps + formation lap, median use');
    expect(load.rows[0].value).toContain('38.50 L');
    expect(load.rows[0].value).toContain('55.00 %');
    expect(load.rows[1].label).toContain('p90 use');
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
    });
    expect(v.cards[0].rows[1].note).toBe(
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
    });
    expect(v.stale).toBe(
      'L per 1 % VE: preset 0.600  ·  last session there 0.700',
    );
  });

  it('leaves the stale line out for no limits', () => {
    const noLimits = rulesFor(
      null,
      {kind: 'laps', value: 45},
      {startL: 84, fillLimitL: 84, tankL: null},
    )!;
    const v = planView(null, noLimits, planRace(noLimits.rules, history), {
      since: null,
      lastFillLimitL: 84,
      ratio: null,
      lastRatio: null,
      ratioLoadsL: [],
    });
    expect(v.stale).toBeNull();
    expect(v.rulesLine).toBe('Rules: last race here (84 L fill limit)');
    expect(v.footnote).toContain('tyres');
  });

  it('shows no data without history', () => {
    const empty = planView(preset, rules, planRace(rules.rules, []), {
      since: null,
      lastFillLimitL: null,
      ratio: null,
      lastRatio: null,
      ratioLoadsL: [],
    });
    expect(empty.cards[0].rows[0].value).toBe('no data');
    expect(empty.cards.some(c => c.key === 'dropStop')).toBe(false);
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
