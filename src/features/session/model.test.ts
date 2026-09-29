import {describe, expect, it} from '@jest/globals';

// Adapters are internal to data/; tests may reach them to build real shapes.
import {toLaps, toSessionDetail} from '@/src/data/sessions/adapters';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {
  type LapRowModel,
  buildSessionModel,
  selectStint,
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
    expect(m.chart!.explainer).toContain('median (1:21.915)');
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

  it('detail explains an excluded lap', () => {
    const m = buildSessionModel(session, laps, {laps: [], hl: ids[16]});
    expect(m.detail).toMatchObject({
      title: 'L17 · 1:30.261',
      status: 'Excluded · Pit in',
      excluded: true,
      action: 'add',
    });
    expect(m.detail!.why).toMatch(/^Ends in the pit lane/);
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
