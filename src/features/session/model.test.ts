import {describe, expect, it} from '@jest/globals';

// Adapters are internal to data/; tests may reach them to build real shapes.
import {toLaps, toSessionDetail} from '@/src/data/sessions/adapters';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {
  type LapRowModel,
  buildSessionModel,
  sectionTable,
  selectStint,
  trafficPaceFacts,
  toggleLap,
} from './model';

// Road Atlanta race, 2026-09-26: 22 laps, two stints, a pit stop at L17/L18.
const session = toSessionDetail(fixture.session);
const laps = toLaps(fixture.laps);
const none = {laps: [], hl: null};
const lapRow = (m: ReturnType<typeof buildSessionModel>, label: string) =>
  m.rows.find((r): r is LapRowModel => r.kind === 'lap' && r.label === label)!;

describe('buildSessionModel', () => {
  const m = buildSessionModel(session, laps, none);

  it('header and facts', () => {
    expect(m.title).toBe('Race · Road Atlanta');
    expect(m.subtitle).toMatch(/^Michelin Raceway Road Atlanta · /);
    expect(m.subtitle).toContain('Porsche 911 GT3 R · Custom #397 · LMU');
    expect(m.facts).toEqual([
      {label: 'Laps', value: '22'},
      {label: 'Comparable', value: '16'},
      {label: 'Best', value: '1:20.763', best: true},
      {label: 'Median', value: '1:21.915'},
      {label: 'Clean median', value: 'No other cars recorded'},
    ]);
  });

  it('one bar per lap, up = faster, clamped at ±1.5 s', () => {
    const bars = m.chart!.bars;
    expect(bars).toHaveLength(22);
    const best = bars.find(b => b.best)!;
    expect(best.lapIndex).toBe(21);
    expect(best.deltaS).toBeCloseTo(81.915 - 80.763);
    expect(bars.find(b => b.lapIndex === 2)!.deltaS).toBe(-1.5);
    expect(bars.find(b => b.lapIndex === 1)!.comparable).toBe(false);
  });

  it('marks the stint change and the pit-in lap', () => {
    expect(m.chart!.stintBreaks).toEqual([{afterLap: 17, label: 'STINT 2'}]);
    expect(m.chart!.pits).toEqual([17]);
  });

  it('stint header rows precede their laps', () => {
    expect(m.rows[0]).toMatchObject({
      kind: 'stint',
      label: 'Stint 1 · L1–L17 · med 1:21.938 · ± 0.91 s',
    });
    expect(m.rows.filter(r => r.kind === 'stint')).toHaveLength(2);
  });

  it('a lap cut short by a reset reads RESET, and marks the chart', () => {
    const raw = fixture.laps.map((l, i) =>
      i === 12 ? {...l, partial: true, endedInReset: true} : l,
    );
    const r = buildSessionModel(session, toLaps(raw), none);
    const codes = lapRow(r, 'L13').tags.map(t => t.code);
    expect(codes).toContain('RESET');
    expect(codes).not.toContain('PART');
    expect(r.chart?.resets).toEqual([13]);
  });

  it('a parked start reads PARK, not PART, ', () => {
    const raw = fixture.laps.map((l, i) =>
      i === 12
        ? {...l, partial: true, partialWhy: 'grid', comparable: false}
        : l,
    );
    const r = buildSessionModel(session, toLaps(raw), none);
    const codes = lapRow(r, 'L13').tags.map(t => t.code);
    expect(codes).toContain('PARK');
    expect(codes).not.toContain('PART');
    const ids = raw.map(l => l.id);
    const d = buildSessionModel(session, toLaps(raw), {laps: [], hl: ids[12]});
    expect(d.detail).toMatchObject({status: 'Excluded · Parked start'});
  });

  it('tags pit, partial, slow, off-track and best laps', () => {
    expect(lapRow(m, 'L17').tags.map(t => t.code)).toContain('IN');
    expect(lapRow(m, 'L18').tags.map(t => t.code)).toContain('OUT');
    expect(lapRow(m, 'L22').tags.map(t => t.code)).toContain('PART');
    expect(lapRow(m, 'L5').tags.map(t => t.code)).toEqual(['SLOW', 'OFF 14.8']);
    expect(lapRow(m, 'L21').tags[0]).toEqual({code: 'BEST', best: true});
  });

  it('gaps only on comparable laps; faster is negative', () => {
    expect(lapRow(m, 'L21')).toMatchObject({gap: '−1.152', gapFaster: true});
    expect(lapRow(m, 'L1').gap).toBeNull();
  });

  it('no detail or tray without a selection', () => {
    expect(m.detail).toBeNull();
    expect(m.tray).toBeNull();
  });
});

describe('selection', () => {
  const ids = laps.map(l => l.id);

  it('detail carries the status of an excluded lap', () => {
    const m = buildSessionModel(session, laps, {laps: [], hl: ids[16]});
    expect(m.detail).toMatchObject({
      title: 'L17 · 1:30.261',
      status: 'Excluded · Pit in',
      excluded: true,
      action: 'add',
    });
  });

  it('first selected lap is the reference and cannot be toggled off', () => {
    let sel = toggleLap(none, ids[20]);
    sel = toggleLap(sel, ids[3]);
    expect(toggleLap(sel, ids[20])).toBe(sel);
    const m = buildSessionModel(session, laps, {...sel, hl: ids[20]});
    expect(m.detail!.action).toBe('reference');
    expect(m.tray).toMatchObject({count: 2, label: 'L21 · L4'});
  });

  it('select stint adds comparable laps after the reference', () => {
    const sel = selectStint({laps: [ids[20]], hl: null}, [
      ids[17],
      ids[18],
      ids[19],
      ids[20],
    ]);
    expect(sel.laps).toEqual([ids[20], ids[17], ids[18], ids[19]]);
    const m = buildSessionModel(session, laps, sel);
    expect(m.tray!.label).toBe('L21 ref + 3 laps');
  });
});

describe('traffic tags, rails and the clean best', () => {
  const traffic = (over: Record<string, number>) => ({
    draftS: 0,
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
    ...over,
  });
  // L21 is the best lap: tow it for 6.1 s. L9 is clean; L10 is held up.
  const raw = fixture.laps.map((l, i) => ({
    ...l,
    traffic:
      i === 20
        ? traffic({draftS: 6.1})
        : i === 9
        ? traffic({trafficAheadS: 5})
        : traffic({}),
  }));
  const m = buildSessionModel(session, toLaps(raw), none);

  it('a towed best lap shows TOW first, then BEST', () => {
    expect(lapRow(m, 'L21').tags.map(t => t.code)).toEqual(['TOW 6.1', 'BEST']);
    expect(lapRow(m, 'L10').tags.map(t => t.code)).toContain('TRAF 5.0');
  });

  it('hollow bars and rails come from the traffic facts', () => {
    expect(m.chart!.bars.find(b => b.lapIndex === 21)!.hollow).toBe(true);
    expect(m.chart!.bars.find(b => b.lapIndex === 5)!.hollow).toBe(false);
    expect(m.chart!.rails).toEqual({tow: [21], tick: [10], pit: [17, 18]});
  });

  it('a session without a field gets no traffic tags or rails', () => {
    const plain = buildSessionModel(session, laps, none);
    expect(plain.chart!.rails).toBeNull();
    expect(plain.chart!.bars.every(b => !b.hollow)).toBe(true);
    expect(lapRow(plain, 'L21').tags.map(t => t.code)).toEqual(['BEST']);
  });
});

describe('fuel and Virtual Energy rows', () => {
  const fuel = (over: Record<string, unknown> = {}) => ({
    startL: 40,
    endL: 37.6,
    usedL: 2.4,
    addedL: 0,
    veStartPct: 50,
    veEndPct: 46.4,
    veUsedPct: 3.6,
    veAddedPct: 0,
    lapsLeftFuel: 15.7,
    lapsLeftVe: 12.9,
    green: true,
    ...over,
  });
  // Lap index 16 is the pit-in lap of this race (L17): give it a stop.
  const raw = fixture.laps.map((l, i) => ({
    ...l,
    fuel: fuel(i === 0 ? {startL: 75} : {}),
    pitStop:
      i === 16
        ? {
            atEntry: {fuelL: 33.31, vePct: 39.9},
            added: {fuelL: 41.72, vePct: 60.1},
            inPitS: 90.5,
            lapsLeftAtEntry: {fuel: 13.9, ve: 11.1},
          }
        : null,
  }));
  const withFuel = toSessionDetail({
    ...fixture.session,
    fuel: {startL: 75, fillLimitL: 75, tankL: 75},
    stints: (fixture.session.stints as Record<string, unknown>[]).map(s => ({
      ...s,
      greenLaps: 15,
      medianFuelL: 2.4,
      medianVePct: 3.6,
    })),
  });
  const m = buildSessionModel(withFuel, toLaps(raw), none);

  it('the pit-in lap has its line under it: what was left, in laps, and what was added', () => {
    const i = m.rows.findIndex(r => r.kind === 'lap' && r.label === 'L17');
    expect(m.rows[i + 1]).toEqual({
      kind: 'note',
      key: expect.stringContaining('-pit'),
      text: 'Pit: 33.3 L / 40 % VE left (11.1 laps) · +41.7 L · 91 s',
      pitLapIndex: 17,
    });
  });

  it('each stint gets its start against the limit and its median use', () => {
    const i = m.rows.findIndex(r => r.kind === 'stint');
    expect(m.rows[i + 1]).toMatchObject({
      kind: 'note',
      text: 'Fuel 2.40 L/lap · VE 3.6 %/lap',
    });
  });

  it("the detail panel has the lap's fuel and VE lines", () => {
    const d = buildSessionModel(withFuel, toLaps(raw), {
      laps: [],
      hl: toLaps(raw)[16].id,
    }).detail!;
    expect(d.fuel[0]).toMatch(/^Fuel 2\.40 L used/);
    expect(d.fuel.at(-1)).toMatch(/^Stop 91 s in the pits/);
  });

  it('a session without fuel data has no fuel rows', () => {
    const plain = buildSessionModel(session, laps, none);
    expect(plain.rows.filter(r => r.kind === 'note')).toEqual([]);
    expect(
      buildSessionModel(session, laps, {laps: [], hl: laps[0].id}).detail!.fuel,
    ).toEqual([]);
  });
});

describe('trafficPaceFacts', () => {
  const field = {gridId: 'g'} as unknown as typeof session.field;
  const set = (laps: number, medianS: number | null) => ({laps, medianS});
  const withTraffic = (
    clean: ReturnType<typeof set>,
    traffic = set(0, null),
  ) => ({...session, field, traffic: {v: 2, clean, traffic}});

  it('says so when the session has no field', () => {
    expect(trafficPaceFacts(session)).toEqual([
      {label: 'Clean median', value: 'No other cars recorded'},
    ]);
  });

  it('is left out for a field not yet analysed for traffic', () => {
    expect(trafficPaceFacts({...session, field})).toEqual([]);
  });

  it('shows the clean median with the laps behind it, and no traffic median', () => {
    const s = withTraffic(set(12, 81.5), set(4, 83));
    expect(trafficPaceFacts(s)).toEqual([
      {
        label: 'Clean median',
        value: `1:21.500 · 12 of ${session.comparableCount} laps`,
      },
    ]);
  });

  it('leaves a set out under the lap floor', () => {
    const s = withTraffic(set(2, null), set(1, null));
    expect(trafficPaceFacts(s)).toEqual([]);
  });
});

describe('traffic in the stint header and the lap detail', () => {
  const traffic = (over: Record<string, unknown>) => ({
    draftS: 0,
    trafficAheadS: 0,
    trafficBehindS: 0,
    blueFlagS: 0,
    passesMade: 0,
    passesSuffered: 0,
    passesMadeAll: 0,
    passesSufferedAll: 0,
    battleS: 0,
    overtakes: [],
    ...over,
  });
  const raw = fixture.laps.map(l => ({...l, traffic: traffic({})}));
  const withField = toLaps(raw);

  it('a stint header gives the clean median with its n, from 3 laps', () => {
    const m = buildSessionModel(session, withField, none);
    const stint = m.rows.find(r => r.kind === 'stint')!;
    expect(stint.kind === 'stint' && stint.label).toMatch(
      / · clean 1:\d\d\.\d{3} \(\d+\)/,
    );
    expect(stint.kind === 'stint' && stint.label).not.toContain('traffic');
  });

  it('a session without traffic facts keeps its stint headers as they were', () => {
    const m = buildSessionModel(session, laps, none);
    const stint = m.rows.find(r => r.kind === 'stint')!;
    expect(stint.kind === 'stint' && stint.label).not.toContain('clean');
  });

  it('the lap detail has a traffic section only with a field', () => {
    const hl = withField[3].id;
    const d = buildSessionModel(session, withField, {laps: [], hl}).detail!;
    expect(d.traffic?.[0]).toEqual({label: 'In a tow', value: '0.0 s'});
    const bare = buildSessionModel(session, laps, {laps: [], hl: laps[3].id});
    expect(bare.detail!.traffic).toBeNull();
  });
});

describe('sectionTable', () => {
  // Three laps alone in the segment, two in a tow: under 5 alone, so no stats.
  const lap = (id: string, t: number, alone: boolean) => ({
    id,
    stint: 1,
    comparable: true,
    timesS: [t],
    alone: [alone],
  });
  const times = {
    segments: [{label: 'T7 entry–T7', range: {fromM: 0, toM: 100}}],
    laps: [
      lap('a', 10, true),
      lap('b', 10.1, true),
      lap('c', 10.2, true),
      lap('d', 10.3, false),
      lap('e', 10.4, false),
    ],
  };

  it('gives the alone count in the median cell and dashes for the rest', () => {
    const table = sectionTable(times)!;
    const [median, best, spread] = table.footer;
    expect(median.cells).toEqual(['3 alone']);
    expect(best.cells).toEqual(['—']);
    expect(spread.cells).toEqual(['—']);
  });

  it('gives the statistics once five laps were alone', () => {
    const table = sectionTable({
      ...times,
      laps: [...times.laps, lap('f', 10.5, true), lap('g', 10.6, true)],
    })!;
    expect(table.footer[0].cells).toEqual(['10.20']);
  });
});
