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
  it('keeps green timed laps with a positive use', () => {
    const out = greenLapsOf('s1', [
      lap(),
      lap({fuel: fuel({green: false})}),
      lap({timeS: null}),
      lap({fuel: null}),
      lap({fuel: fuel({usedL: 0})}),
      lap({fuel: fuel({usedL: null})}),
    ]);
    expect(out).toEqual([
      {fuelL: 3.5, vePct: 5, lapTimeS: 110, sessionId: 's1'},
    ]);
  });

  it('drops a VE of zero or none, keeping the fuel', () => {
    const out = greenLapsOf('s1', [
      lap({fuel: fuel({veUsedPct: null})}),
      lap({fuel: fuel({veUsedPct: 0})}),
    ]);
    expect(out.map(l => l.vePct)).toEqual([null, null]);
    expect(out).toHaveLength(2);
  });
});

describe('rulesFor', () => {
  const length = {kind: 'min' as const, value: 60};
  const last = {startL: 89, fillLimitL: 84, tankL: 115};

  it('uses the preset fuel first, then fill limit, tank and start fuel', () => {
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
    expect(
      rulesFor(null, length, {startL: 89, fillLimitL: null, tankL: 115}),
    ).toMatchObject({fuelSource: 'tank', rules: {fuelL: 115}});
    expect(
      rulesFor(null, length, {startL: 89, fillLimitL: null, tankL: null}),
    ).toMatchObject({fuelSource: 'start fuel', rules: {fuelL: 89}});
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
  const view = planView(preset, rules, planRace(rules.rules, history), {
    since: '2026-09-01T10:00:00Z',
    lastFillLimitL: 75,
  });

  it('names the rules and flags a preset that differs from the last session', () => {
    expect(view.rulesLine).toContain('Endurance 75 % fuel');
    expect(view.rulesLine).toContain('set ');
    expect(view.stale).toBe('preset 84 L  ·  last session there 75 L');
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
    expect(drop[1].value).toBe('no data');
  });

  it('has no equal-stints row when the race needs no stop', () => {
    const short = rulesFor(
      null,
      {kind: 'laps', value: 10},
      {startL: 84, fillLimitL: 84, tankL: null},
    )!;
    const v = planView(null, short, planRace(short.rules, history), {
      since: null,
      lastFillLimitL: null,
    });
    const stops = v.cards.find(c => c.key === 'stops')!;
    expect(stops.rows.map(r => r.label)).toEqual([
      'At median use',
      'At p90 use',
    ]);
    expect(stops.rows[0].value).toBe('no stop');
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
    });
    expect(v.stale).toBeNull();
    expect(v.rulesLine).toContain('No limits');
    expect(v.footnote).toContain('tyres');
  });

  it('shows no data without history', () => {
    const empty = planView(preset, rules, planRace(rules.rules, []), {
      since: null,
      lastFillLimitL: null,
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
