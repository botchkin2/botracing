import {describe, expect, it} from '@jest/globals';

// Adapters are internal to data/; tests may reach them to build real shapes.
import {toLaps, toSessionDetail} from '@/src/data/sessions/adapters';
import type {Lap} from '@/src/data/sessions';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {
  gridCellTargetOf,
  type LapRowModel,
  buildSessionModel,
  type SectionTable,
  sectionTable,
  trafficPaceFacts,
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
      {label: 'Best', value: '1:20.763', best: true, basis: 'session'},
      {label: 'Median', value: '1:21.915', basis: 'of 16'},
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
      // The opening ticks are none here, so the basis is the comparable laps:
      // 13 of stint 1, IQR 1.219 s recomputed from the fixture's lap times.
      label: 'Stint 1 · L1–L17 · med 1:21.938 · IQR 1.22 s · of 13',
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

  it('a whole lap the game did not time reads INV with its own time, and counts in nothing', () => {
    // L25 of 682524ed (2026-10-14): LMU invalidated a full lap; it read PART, no time.
    const raw = fixture.laps.map((l, i) =>
      i === 12
        ? {
            ...l,
            timed: false,
            invalid: true,
            lapTime: 121.627,
            partial: false,
            comparable: false,
            reasons: ['untimed'],
          }
        : l,
    );
    const r = buildSessionModel(session, toLaps(raw), none);
    const row = lapRow(r, 'L13');
    const codes = row.tags.map(t => t.code);
    expect(codes).toContain('INV');
    expect(codes).not.toContain('PART');
    expect(row.time).toBe('2:01.627');
    expect(toLaps(raw)[12].timeS).toBeNull();
    const ids = raw.map(l => l.id);
    const d = buildSessionModel(session, toLaps(raw), {laps: [], hl: ids[12]});
    expect(d.detail).toMatchObject({status: 'Excluded · Invalid'});
  });

  it('an untimed lap without the invalid fact is not INV (a reset fragment stays PART)', () => {
    // L4 of 682524ed: 80 s cut by a reset, untimed, stored before the reset fix as whole.
    const raw = fixture.laps.map((l, i) =>
      i === 12
        ? {
            ...l,
            timed: false,
            lapTime: 80.673,
            partial: false,
            reasons: ['untimed'],
          }
        : l,
    );
    const r = buildSessionModel(session, toLaps(raw), none);
    expect(lapRow(r, 'L13').tags.map(t => t.code)).toContain('PART');
    expect(lapRow(r, 'L13').time).toBe('—');
  });

  it('a pit or cut lap the game did not time is not INV', () => {
    const raw = fixture.laps.map((l, i) =>
      i === 12
        ? {...l, timed: false, partial: true, reasons: ['untimed']}
        : i === 13
        ? {...l, timed: false, pitOut: true, reasons: ['untimed', 'pit-out']}
        : l,
    );
    const r = buildSessionModel(session, toLaps(raw), none);
    expect(lapRow(r, 'L13').tags.map(t => t.code)).toContain('PART');
    expect(lapRow(r, 'L14').tags.map(t => t.code)).not.toContain('INV');
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

  it('no detail without a selection; the tray keeps the two stints to pick', () => {
    expect(m.detail).toBeNull();
    expect(m.tray).toMatchObject({count: 0, label: '', laps: []});
    expect(m.tray!.stints.map(s => [s.label, s.active])).toEqual([
      ['1', false],
      ['2', false],
    ]);
  });

  it('one stint has nothing to pick: no tray without a selection', () => {
    const one = {...session, stints: session.stints.slice(0, 1)};
    const oneLaps = laps.map(l => ({...l, stint: 1}));
    expect(buildSessionModel(one, oneLaps, none).tray).toBeNull();
    expect(
      buildSessionModel(one, oneLaps, {laps: [oneLaps[3].id], hl: null}).tray!
        .stints,
    ).toEqual([]);
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

  it('no lap is the reference: the highlighted lap is removable like any other', () => {
    const sel = {laps: [ids[20], ids[3]], hl: ids[20]};
    const m = buildSessionModel(session, laps, sel);
    expect(m.detail!.action).toBe('remove');
    expect(m.tray).toMatchObject({count: 2, label: 'L21 · L4'});
  });

  it('a tray of more than three laps says how many, without naming a reference', () => {
    const sel = {laps: [ids[17], ids[18], ids[19], ids[20]], hl: null};
    const m = buildSessionModel(session, laps, sel);
    expect(m.tray!.label).toBe('4 laps');
  });
});

describe('stint picks (D16/D17)', () => {
  const stintRow = (m: ReturnType<typeof buildSessionModel>, n: number) =>
    m.rows.find(r => r.kind === 'stint' && r.key === `stint-${n}`) as {
      lapIds: string[];
    };
  const base = buildSessionModel(session, laps, none);

  it("each pick is its stint header's comparable laps", () => {
    for (const pick of base.tray!.stints)
      expect(pick.lapIds).toEqual(stintRow(base, pick.n).lapIds);
  });

  it('a pick is marked while the selection is exactly its laps, in any order', () => {
    const two = stintRow(base, 2).lapIds;
    const m = buildSessionModel(session, laps, {
      laps: [...two].reverse(),
      hl: null,
    });
    expect(m.tray!.stints.map(s => s.active)).toEqual([false, true]);
    expect(m.tray!.count).toBe(two.length);
  });

  it('unticking one lap of the stint clears the mark; adding one does too', () => {
    const two = stintRow(base, 2).lapIds;
    const less = buildSessionModel(session, laps, {
      laps: two.slice(1),
      hl: null,
    });
    expect(less.tray!.stints.some(s => s.active)).toBe(false);
    const more = buildSessionModel(session, laps, {
      laps: [...two, stintRow(base, 1).lapIds[0]],
      hl: null,
    });
    expect(more.tray!.stints.some(s => s.active)).toBe(false);
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
    expect(lapRow(m, 'L21').tags.map(t => t.code)).toEqual([
      'TOW 6.1 s',
      'BEST',
    ]);
    expect(lapRow(m, 'L10').tags.map(t => t.code)).toContain('TRAF 5.0 s');
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
      text: 'Pit: 33.3 L / 40 % VE left (11.1 laps · VE) · +41.7 L · 91 s',
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
  const traffic = (aheadS: number) => ({
    trafficAheadS: aheadS,
    passesSufferedAll: 0,
    blueFlagS: 0,
    battleS: 0,
    overtakes: [],
  });
  // A lap: its time, and its traffic block (null = no field recorded).
  const lap = (timeS: number, aheadS: number | null, comparable = true) =>
    ({
      timeS,
      comparable,
      traffic: aheadS == null ? null : traffic(aheadS),
    } as unknown as Lap);
  const clean = [lap(81, 0), lap(82, 0), lap(83, 0), lap(84, 0)];

  it('says so when the session has no field', () => {
    expect(trafficPaceFacts(session, [lap(81, null)])).toEqual([
      {label: 'Clean median', value: 'No other cars recorded'},
    ]);
  });

  it('is left out for a field not yet analysed for traffic', () => {
    expect(trafficPaceFacts({...session, field}, [lap(81, null)])).toEqual([]);
  });

  it('is the clean median of the basis laps, with how many of them', () => {
    const laps = [...clean, lap(90, 6), lap(91, 6)];
    expect(trafficPaceFacts({...session, field}, laps)).toEqual([
      {label: 'Clean median', value: '1:22.500 · 4 of 6 laps'},
    ]);
    // Drop a clean lap from the basis and the head moves with it.
    expect(trafficPaceFacts({...session, field}, laps.slice(1))).toEqual([
      {label: 'Clean median', value: '1:23.000 · 3 of 5 laps'},
    ]);
  });

  it('leaves a set out under the lap floor', () => {
    expect(
      trafficPaceFacts({...session, field}, [
        lap(81, 0),
        lap(82, 0),
        lap(90, 6),
      ]),
    ).toEqual([]);
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
  // Five laps timed in the segment, two of them in a tow: tow and traffic are
  // flags, never exclusions (Botkin, 2026-10-01), so all five count.
  const lap = (id: string, t: number) => ({
    id,
    stint: 1,
    comparable: true,
    timesS: [t],
  });
  const times = {
    segments: [{label: 'T7 entry–T7', range: {fromM: 0, toM: 100}}],
    laps: [
      lap('a', 10),
      lap('b', 10.1),
      lap('c', 10.2),
      lap('d', 10.3),
      lap('e', 10.4),
    ],
  };

  it('gives median, best and IQR over the basis laps, named IQR', () => {
    const table = sectionTable(times, new Set(['a', 'b', 'c', 'd', 'e']))!;
    expect(table.footer.map(r => r.label)).toEqual(['Median', 'Best', 'IQR']);
    const [median, best, iqr] = table.footer;
    expect(median.cells).toEqual(['10.20']);
    expect(best.cells).toEqual(['10.00']);
    // 10.0 … 10.4: p75 10.3 − p25 10.1.
    expect(iqr.cells).toEqual(['0.20']);
  });

  it('follows the ticks: unticking the slowest two moves every row', () => {
    const table = sectionTable(times, new Set(['a', 'b', 'c']))!;
    expect(table.footer.map(r => r.cells[0])).toEqual([
      '10.10',
      '10.00',
      '0.10',
    ]);
  });
});

describe('lap colour slots follow the meaning, not the order laps were checked in', () => {
  const ids = laps.slice(0, 22).map(l => l.id);
  const slotsOf = (checked: string[], ref: string | null) => {
    const m = buildSessionModel(session, laps, {laps: checked, ref, hl: null});
    return Object.fromEntries(
      m.rows
        .filter((r): r is LapRowModel => r.kind === 'lap')
        .filter(r => r.selIndex != null)
        .map(r => [r.label, r.selIndex]),
    );
  };

  it('slot 0 is the Ref lap only; the others follow by lap number from 1', () => {
    expect(slotsOf([ids[8], ids[2], ids[5]], ids[5])).toEqual({
      L3: 1,
      L6: 0,
      L9: 2,
    });
  });

  it('with no Ref nobody is slot 0, and the order checked does not matter', () => {
    const a = slotsOf([ids[8], ids[2], ids[5]], null);
    expect(a).toEqual({L3: 1, L6: 2, L9: 3});
    expect(slotsOf([ids[2], ids[5], ids[8]], null)).toEqual(a);
    const tray = buildSessionModel(session, laps, {
      laps: [ids[8], ids[2]],
      ref: null,
      hl: null,
    }).tray;
    expect(tray?.laps.map(l => l.selIndex).sort()).toEqual([1, 2]);
  });
});

describe('gridCellTargetOf (Road Atlanta numbering)', () => {
  // Heads S/F, T1, T2–5, T6, T7, T10a–T12. Sections 1..5: section 2 is the
  // compound T2–5 (corners 2 to 5), so its first corner is 2; section 3 is T6.
  const table: SectionTable = {
    heads: ['S/F', 'T1', 'T2–5', 'T6', 'T7', 'T10a–T12'],
    sections: [null, 1, 2, 3, 4, 5],
    targets: [
      {corner: null, whole: false},
      {corner: 1, whole: false},
      {corner: 2, whole: true},
      {corner: 6, whole: false},
      {corner: 7, whole: false},
      {corner: 10, whole: false},
    ],
    footer: [],
  };

  it('opens the corner by its number, not the section number (S3 is T6, corner 6)', () => {
    expect(gridCellTargetOf(table, 3, 'L4', ['L4'])).toEqual({
      corner: 6,
      whole: false,
      laps: ['L4'],
    });
  });

  it('opens a compound section on All, on its first corner (S2 is T2–5: corner 2, all)', () => {
    expect(gridCellTargetOf(table, 2, 'L4', ['L4'])).toEqual({
      corner: 2,
      whole: true,
      laps: ['L4'],
    });
  });

  it('keeps the checked set: the tapped lap is only a highlight', () => {
    expect(gridCellTargetOf(table, 1, 'L1', ['L4', 'L5'])).toEqual({
      corner: 1,
      whole: false,
      laps: ['L4', 'L5'],
    });
  });

  it('the start straight opens nothing', () => {
    expect(gridCellTargetOf(table, 0, 'L4', ['L4'])).toBeNull();
  });
});
