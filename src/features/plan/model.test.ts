import {describe, expect, it} from '@jest/globals';

import {planRace, type GreenLap} from '@/src/analysis/fuelPlan';
import {
  type Lap,
  type LapFuel,
  type SessionDetail,
  type SessionFuel,
  type SessionSummary,
} from '@/src/data/sessions';
import {newPreset} from '@/src/state/fuelPresets';

import {
  carChoices,
  type Combo,
  comboCar,
  comboTrack,
  defaultCombo,
  driftRowOf,
  fuelOnly,
  greenLapsOf,
  eventLoad,
  HISTORY_SESSIONS,
  historySessions,
  limitsOfDetails,
  planCombos,
  parseNumber,
  planView,
  rulesCells,
  rulesFor,
  sessionLimitL,
  startChips,
  trackChoices,
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
  classLaps: null,
  finish: null,
  eventId: null,
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
  lapsLeftFuel: null,
  lapsLeftVe: null,
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

describe('the track and car choices', () => {
  const combos = planCombos([
    session('a', '2026-09-01T10:00:00Z'),
    session('b', '2026-09-20T10:00:00Z', {
      trackId: 'lmu-sebring',
      track: 'Sebring',
      car: 'Cadillac WTR 2026 #101:LM',
      carClass: 'Hypercar',
    }),
    session('c', '2026-09-10T10:00:00Z', {car: 'Cadillac WTR 2026 #101:LM'}),
  ]);
  const [sebring, daytonaCadillac, daytona911] = [
    combos.find(c => c.trackId === 'lmu-sebring')!,
    combos.find(c => c.trackId === 'lmu-daytona' && c.car.startsWith('Cad'))!,
    combos.find(c => c.trackId === 'lmu-daytona' && c.car.startsWith('Por'))!,
  ];

  it('splits a chip label into its track and its car', () => {
    expect(comboTrack(daytona911)).toBe('Daytona');
    expect(comboCar(daytona911)).toBe('911 GT3 R');
  });

  it('lists a track once, and a track keeps the current car where it was driven', () => {
    const tracks = trackChoices(combos, daytonaCadillac);
    expect(tracks.map(t => [t.label, t.selected])).toEqual([
      ['Sebring', false],
      ['Daytona', true],
    ]);
    // Sebring has only the Cadillac, which is the current car: that combo.
    expect(tracks[0].key).toBe(sebring.key);
    // From the 911 at Daytona, Sebring has no 911, so it takes its newest car.
    expect(trackChoices(combos, daytona911)[0].key).toBe(sebring.key);
  });

  it('lists the cars of the current track and marks the one in force', () => {
    expect(
      carChoices(combos, daytona911).map(c => [c.label, c.selected]),
    ).toEqual([
      [comboCar(daytonaCadillac), false],
      ['911 GT3 R', true],
    ]);
  });
});

describe('startChips', () => {
  const caps = {fuelL: 100, vePct: 100};

  it('offers the start of the last race under the full load as a one-tap chip, never as a value', () => {
    expect(startChips({fuelL: 100, vePct: 87}, caps, true)).toEqual({
      ve: {label: 'Last race here: 87 %', text: '87'},
      fuel: null,
    });
    expect(startChips({fuelL: 52.04, vePct: 100}, caps, true)).toEqual({
      ve: null,
      fuel: {label: 'Last race here: 52.0 L', text: '52.0'},
    });
  });

  it('offers nothing for a full start, no recorded start, or VE on a car without it', () => {
    expect(startChips({fuelL: 100, vePct: 100}, caps, true)).toEqual({
      ve: null,
      fuel: null,
    });
    expect(startChips(null, caps, true)).toEqual({ve: null, fuel: null});
    expect(startChips({fuelL: 100, vePct: 87}, caps, false).ve).toBeNull();
  });

  it('rulesFor takes the typed start into the rules, blank (null) staying a full load', () => {
    const base = rulesFor(
      null,
      {kind: 'laps', value: 40},
      sessionFuel({fillLimitL: 100}),
      {},
    )!;
    expect(base.rules.startVePct).toBeNull();
    const typed = rulesFor(
      null,
      {kind: 'laps', value: 40},
      sessionFuel({fillLimitL: 100}),
      {
        vePct: 87,
        fuelL: null,
      },
    )!;
    expect(typed.rules.startVePct).toBe(87);
    expect(typed.rules.startFuelL).toBeNull();
  });
});

describe('rulesCells', () => {
  const rules = {
    name: 'ELMS 2 h',
    lengthLaps: null,
    lengthMin: 120,
    fuelL: 100,
    vePct: 100,
    formationLap: true,
    mandatoryStops: 0,
  };

  it('finishes the numbers the plan is worked with', () => {
    expect(rulesCells(rules, true, 0.9)).toEqual([
      {label: 'Max fuel', value: '100 L'},
      {label: 'Max VE', value: '100 %'},
      {label: '1 % VE', value: '0.90 L'},
      {label: 'Mandatory', value: '0 stops'},
      {label: 'Formation', value: '1 lap'},
    ]);
  });

  it('leaves the VE numbers out for a car with no VE, and says one stop in the singular', () => {
    const cells = rulesCells(
      {...rules, mandatoryStops: 1, formationLap: false},
      false,
      null,
    );
    expect(cells.map(c => c.label)).toEqual([
      'Max fuel',
      'Mandatory',
      'Formation',
    ]);
    expect(cells[1].value).toBe('1 stop');
    expect(cells[2].value).toBe('none');
  });

  it('is empty without rules', () => {
    expect(rulesCells(null, true, 0.9)).toEqual([]);
  });
});

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
    const limits = combo.sessions.map(() => 75);
    const ids = historySessions(combo, limits).map(s => s.id);
    expect(ids).toHaveLength(HISTORY_SESSIONS);
    expect(ids[0]).toBe(`s${HISTORY_SESSIONS + 2}`);
  });

  // Fuel per lap is the car on the track: laps from every load are pooled in
  // litres (thread 44 #1968); a session doc still loading is not used yet.
  it('pools sessions of every fill limit, never one still loading', () => {
    const [combo] = planCombos([
      session('old', '2026-04-01T10:00:00Z'),
      session('other', '2026-08-01T10:00:00Z'),
      session('loading', '2026-08-05T10:00:00Z'),
      session('none', '2026-08-06T10:00:00Z'),
      session('new', '2026-08-13T10:00:00Z'),
    ]);
    // combo.sessions is newest first: new, none, loading, other, old.
    const limits = [100, null, undefined, 75, 79];
    expect(historySessions(combo, limits).map(s => s.id)).toEqual([
      'new',
      'none',
      'other',
      'old',
    ]);
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
      {
        fuelL: 3.5,
        vePct: 5,
        lapTimeS: 110,
        sessionId: 's1',
        veMeasured: true,
        traffic: null,
      },
    ]);
  });

  it('carries the traffic facts of a lap for the clean and traffic medians', () => {
    const facts = {
      draftS: 0,
      trafficAheadS: 6,
      trafficBehindS: 0,
      blueFlagS: 0,
      passesMade: 0,
      passesSuffered: 0,
      passesMadeAll: 0,
      passesSufferedAll: 1,
      battleS: 0.5,
      overtakes: [],
      aheadSpans: [],
      blueSpans: [],
      draftSpans: [],
      passMarks: [],
      fieldLapM: null,
    };
    const [out] = greenLapsOf('s1', [lap({traffic: facts})], 0.7);
    expect(out.traffic).toEqual({
      trafficAheadS: 6,
      passesSufferedAll: 1,
      blueFlagS: 0,
      battleS: 0.5,
      overtakes: [],
    });
  });

  it('marks a lap whose own VE was not recorded, even when the ratio gives it a VE', () => {
    const out = greenLapsOf(
      's1',
      [lap({fuel: fuel({veUsedPct: null})}), lap()],
      0.7,
    );
    expect(out.map(l => l.veMeasured)).toEqual([false, true]);
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

  it('has no ratio when no session ran the preset load: nothing is estimated from the load', () => {
    const p60 = newPreset('X', {fuelL: 60}, 'p3', '2026-09-26T00:00:00Z');
    expect(veRatioFor(p60, sessions)).toBeNull();
    // A session with no recorded fill limit cannot be matched either.
    expect(
      veRatioFor(p60, [
        {startedAt: '2026-09-20T10:00:00Z', ratio: 0.81, fillLimitL: null},
      ]),
    ).toBeNull();
  });

  it('takes the ratio of the planned event only, never another event with a ratio', () => {
    const events = [
      {
        startedAt: '2026-10-02T00:12:00Z',
        ratio: null,
        fillLimitL: 100,
        inEvent: true,
      },
      {
        startedAt: '2026-09-26T00:38:00Z',
        ratio: 0.675,
        fillLimitL: 75,
        inEvent: false,
      },
    ];
    expect(veRatioFor(null, events)).toBeNull();
    expect(
      veRatioFor(null, [{...events[0], ratio: 0.968}, ...events.slice(1)])!
        .perPctL,
    ).toBe(0.968);
  });

  it('the newest ratio of the event wins, practice or race alike', () => {
    expect(veRatioFor(null, sessions)!.perPctL).toBe(0.81);
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

  it('prints the row cards that are left: Per green lap and To drop a stop', () => {
    // Race, Per tank and Stops are typed cards now (planCards.test.ts).
    expect(view.cards.map(c => c.key)).toEqual(['perLap', 'dropStop']);
    // One unit at a time, VE first (thread 44 #1826).
    const perLap = view.cards[0].rows;
    expect(perLap.map(r => r.label)).not.toContain('Fuel');
    expect(perLap[0].value).toBe('5.00 %  (5.00 % to 5.00 %)');
    expect(perLap[perLap.length - 1].value).toContain(
      '10 laps in 2 sessions, since ',
    );
  });

  it('asked for fuel it prints the fuel row and not the VE one', () => {
    const fuel = planView(
      preset,
      rules,
      planRace(rules.rules, history),
      {
        since: '2026-09-01T10:00:00Z',
        lastFillLimitL: 75,
        ratio,
        lastRatio: 0.7,
        ratioLoadsL: [84],
        drift: null,
      },
      'fuel',
    );
    const rows = fuel.cards[0].rows;
    expect(rows[0].value).toBe('3.50 L  (3.50 L to 3.50 L)');
    expect(rows.map(r => r.label)).not.toContain('Virtual Energy');
    // The drop-a-stop line speaks fuel too.
    const drop = fuel.cards.find(c => c.key === 'dropStop')!.rows[0].value;
    expect(drop).toContain('Fuel:');
    expect(drop).not.toContain('VE:');
  });

  it('Per green lap: the all-green median is the headline and sets the race laps, clean and traffic follow with their n', () => {
    const withTraffic = planView(
      preset,
      rules,
      planRace(rules.rules, history),
      {
        since: null,
        lastFillLimitL: 75,
        ratio,
        lastRatio: 0.7,
        ratioLoadsL: [84],
        drift: null,
        traffic: {
          v: 4,
          clean: {laps: 4, medianS: 108.2},
          traffic: {laps: 5, medianS: 111.5},
        },
      },
    );
    const rows = withTraffic.cards[0].rows;
    const time = rows.find(r => r.label === 'Lap time')!;
    expect(time.value).toBe('1:50.000  (1:50.000 to 1:50.000)');
    expect(time.note).toBe('all green laps · n 10 · sets race laps');
    const clean = rows.find(r => r.label === 'Clean laps')!;
    expect([clean.value, clean.note]).toEqual(['1:48.200', 'n 4']);
    const traffic = rows.find(r => r.label === 'Traffic laps')!;
    expect([traffic.value, traffic.note]).toEqual(['1:51.500', 'n 5']);
    // The headline comes first, the secondary rows after it.
    const labels = rows.map(r => r.label);
    expect(labels.indexOf('Lap time')).toBeLessThan(
      labels.indexOf('Clean laps'),
    );
  });

  it('Per green lap: a set under 3 laps, or no field, adds no row', () => {
    const few = planView(preset, rules, planRace(rules.rules, history), {
      since: null,
      lastFillLimitL: 75,
      ratio,
      lastRatio: 0.7,
      ratioLoadsL: [84],
      drift: null,
      traffic: {
        v: 4,
        clean: {laps: 2, medianS: null},
        traffic: {laps: 7, medianS: 111.5},
      },
    });
    const labels = few.cards[0].rows.map(r => r.label);
    expect(labels).not.toContain('Clean laps');
    expect(labels).toContain('Traffic laps');
    // The view above has no traffic at all: neither row.
    expect(view.cards[0].rows.map(r => r.label)).not.toContain('Traffic laps');
    expect(view.cards[0].rows.map(r => r.label)).not.toContain('Clean laps');
  });

  it('prints the drop-one-stop line', () => {
    const drop = view.cards[1].rows;
    expect(drop[0].label).toBe('1 stop');
    // Fuel (3.5 L) would still reach at 3.65 L a lap: only VE has to drop,
    // and VE is the one unit the line speaks in.
    expect(drop[0].value).toContain('VE: at most 4.35 % a lap');
    expect(drop[0].value).not.toContain('Fuel:');
    expect(drop[1].label).toBe('Your laps at <= 4.35 % VE');
    expect(drop[1].value).toBe('no data  (n = 0)');
  });

  it('shows where the VE ratio came from', () => {
    const note = view.cards[0].rows[0].note;
    expect(note).toContain('0.700 L per 1 % VE');
    expect(note).toContain('measured in the session of ');
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
      drift: null,
    });
    expect(v.cards[0].rows[0].note).toBe(
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

describe('sessionLimitL', () => {
  it('reads the limit as rulesFor does: limit, else start fuel, else tank', () => {
    const f = (o: Partial<SessionFuel>) => ({
      startL: null,
      fillLimitL: null,
      tankL: null,
      litresPerVePct: null,
      litresPerVePctStop: null,
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
      'not in line with your 23 other sessions: the plan uses the 15 laps of the 3 sessions since the change',
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
    expect(row.note).toContain('1 other session:');
    expect(row.note).toContain('the 6 laps of the 1 session since');
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
      'lower than your 4 other sessions, and not used for the plan: it switches once a second session in a row agrees',
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

describe('defaultCombo', () => {
  const combo = (key: string, comparable: number[]): Combo => ({
    key,
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

describe('limitsOfDetails', () => {
  const doc = (fillLimitL: number) =>
    ({
      fuel: {fillLimitL, startL: null, tankL: null},
    } as unknown as SessionDetail);

  it('is pending while a session doc is still loading', () => {
    expect(limitsOfDetails([doc(75), undefined], true)).toEqual({
      pending: true,
      limitsL: [75, undefined],
    });
  });

  it('is not pending when a session failed to load: it is left out, not waited for', () => {
    const state = limitsOfDetails([doc(75), undefined], false);
    expect(state.pending).toBe(false);
    expect(state.limitsL).toEqual([75, undefined]);
  });
});

// Road Atlanta 911, thread 44 #1954: every session on record ran a 75 L load
// (2.40 L a lap, 0.675 L per % of VE); the event being planned is a 100 L one,
// where a % of VE is worth 0.968 L. The same fuel a lap reads 2.5 % there, not
// the 3.5 % it read at 75 L, and 40 minutes need no stop.
describe('planning an event with litres pooled from other events', () => {
  const history = Array.from({length: 12}, (_, i) =>
    lap({
      id: `l${i}`,
      timeS: 81.3,
      fuel: fuel({usedL: 2.4, veUsedPct: 3.55, green: true}),
    }),
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
    const ratio = veRatioFor(null, [
      {
        startedAt: '2026-10-02T00:12:00Z',
        ratio: 0.968,
        fillLimitL: 100,
        inEvent: true,
      },
      {
        startedAt: '2026-09-26T00:38:00Z',
        ratio: 0.675,
        fillLimitL: 75,
        inEvent: false,
      },
    ])!;
    expect(ratio.perPctL).toBe(0.968);
    const plan = planRace(rules, greenLapsOf('s', history, ratio.perPctL));
    expect(plan.perLap.ve!.median).toBeCloseTo(2.4 / 0.968, 6);
    expect(plan.raceLaps!.estimate).toBe(30);
    expect(plan.atMedian.stops).toBe(0);
  });

  it('with only another event on record there is no VE yet, and the fuel plan still needs no stop', () => {
    expect(
      veRatioFor(null, [
        {
          startedAt: '2026-09-26T00:38:00Z',
          ratio: 0.675,
          fillLimitL: 75,
          inEvent: false,
        },
      ]),
    ).toBeNull();
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
