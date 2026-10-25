import {describe, expect, it} from '@jest/globals';

import {sectionOptimum} from '@/src/analysis/sectionOptimum';
import {type SegmentTimes} from '@/src/analysis/segments';
// Adapters are internal to data/; tests may reach them to build real shapes.
import {openingLapIds, sectorSegmentTimes} from '@/src/data/sessions';
import {toLaps, toSessionDetail} from '@/src/data/sessions/adapters';
import {formatLapTime} from '@/src/design';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {buildStintTable} from './desktopModel';
import {cornerCellOf, sessionGrid} from './grid';
import {buildSessionModel} from './model';
import {lapTimeStats, segmentBasisStats, stintNumbers} from './selectionStats';

// Road Atlanta race, 2026-09-26: 22 laps, 16 comparable; stint 1 = L1–L17
// (13 comparable), stint 2 = L18–L22 (3 comparable). Sector times on every lap.
const session = toSessionDetail(fixture.session);
const laps = toLaps(fixture.laps);
const comparable = laps.filter(l => l.comparable && l.timeS != null);
const stint1 = comparable.filter(l => l.stint === 1);

const seg = (label: string) => ({label, range: null});
const small = (): SegmentTimes => ({
  segments: [seg('S1'), seg('S2')],
  laps: [
    {id: 'a', stint: 1, comparable: true, timesS: [10, 20]},
    {id: 'b', stint: 1, comparable: true, timesS: [11, 19]},
    {id: 'c', stint: 1, comparable: true, timesS: [12, 21]},
    {id: 'd', stint: 1, comparable: true, timesS: [10.5, 20.5]},
    {id: 'e', stint: 1, comparable: true, timesS: [13, 22]},
    {id: 'x', stint: 1, comparable: false, timesS: [9, 18]},
  ],
});

describe('segmentBasisStats', () => {
  it('counts exactly the basis laps: a ticked non-comparable lap counts, an unticked one does not', () => {
    const t = small();
    const all = segmentBasisStats(t, new Set(['a', 'b', 'c', 'd', 'e']));
    expect(all[0]).toMatchObject({n: 5, bestS: 10, medianS: 11});
    const withX = segmentBasisStats(t, new Set(['a', 'x']));
    expect(withX[0]).toMatchObject({n: 2, bestS: 9});
  });
});

describe('stintNumbers', () => {
  it('Optimal is the best ticked segments summed, Median the median ticked lap, Inconsistency the difference', () => {
    const basis = new Set(stint1.map(l => l.id));
    const times = sectorSegmentTimes(laps)!;
    const [s1] = stintNumbers(laps, basis, times);
    const optimum = sectionOptimum(
      times.laps
        .filter(l => basis.has(l.id))
        .map(l => ({id: l.id, stint: l.stint, windowsS: l.timesS})),
      times.segments.length,
    )[0];
    expect(s1.n).toBe(13);
    expect(s1.optimalS).toBeCloseTo(optimum.bestSumS as number, 9);
    expect(s1.lapTimes.medianS).toBeCloseTo(81.938, 3);
    expect(s1.inconsistencyS).toBeCloseTo(
      (s1.lapTimes.medianS as number) - (s1.optimalS as number),
      9,
    );
  });

  it('a stint under five basis laps has a median but no Optimal', () => {
    const basis = new Set(comparable.map(l => l.id));
    const s2 = stintNumbers(laps, basis, sectorSegmentTimes(laps)).find(
      s => s.stint === 2,
    )!;
    expect(s2.n).toBe(3);
    expect(s2.lapTimes.medianS).not.toBeNull();
    expect(s2.optimalS).toBeNull();
    expect(s2.inconsistencyS).toBeNull();
  });

  it('a stint with no basis lap has no entry', () => {
    const basis = new Set(stint1.map(l => l.id));
    expect(stintNumbers(laps, basis, null).map(s => s.stint)).toEqual([1]);
  });
});

describe('one answer per question (decision 2026-10-11)', () => {
  // The worst comparable lap of stint 1, unticked: the 2 Oct check in miniature.
  const worst = [...stint1].sort(
    (a, b) => (b.timeS as number) - (a.timeS as number),
  )[0];
  const all = comparable.map(l => l.id);
  const less = all.filter(id => id !== worst.id);
  const model = (ticks: string[]) =>
    buildSessionModel(session, laps, {laps: ticks, ref: null, hl: null});

  it('unticking a lap moves every analysed number together', () => {
    const before = model(all);
    const after = model(less);
    expect(after.sections!.footer).not.toEqual(before.sections!.footer);
    expect(after.optimum).not.toEqual(before.optimum);
    const stintLabel = (m: ReturnType<typeof model>) =>
      m.rows.find(r => r.kind === 'stint')!;
    expect(stintLabel(after)).not.toEqual(stintLabel(before));
    expect(after.chart!.bars).not.toEqual(before.chart!.bars);
    // The session facts (laps, comparable, best) do not move: they are what
    // happened. The head's Median and Spread are comparisons, so they move with the ticks.
    const facts = (m: ReturnType<typeof model>) =>
      m.facts.filter(f => f.label !== 'Median' && f.label !== 'Spread');
    expect(facts(after)).toEqual(facts(before));
    const medianFact = (m: ReturnType<typeof model>) =>
      m.facts.find(f => f.label === 'Median')?.value;
    expect(medianFact(after)).toBe(
      formatLapTime(
        lapTimeStats(comparable.filter(l => l.id !== worst.id))
          .medianS as number,
      ),
    );
    expect(medianFact(after)).not.toBe(medianFact(before));
  });

  it('the stint line and the Stints panel give one median, spread and count', () => {
    const m = model(less);
    const picked = stint1.filter(l => l.id !== worst.id);
    const stats = lapTimeStats(picked);
    const median = formatLapTime(stats.medianS as number);
    const stint = m.rows.find(r => r.kind === 'stint');
    expect(stint).toMatchObject({
      label: expect.stringContaining(
        `med ${median} · spread ${(stats.spreadS as number).toFixed(
          2,
        )} s · of 12`,
      ),
    });
    expect(m.optimum.find(f => f.label.startsWith('Median'))?.value).toBe(
      `${median} · of 12`,
    );
    const [panel] = buildStintTable(session, laps, new Set(less));
    expect(panel).toMatchObject({
      count: '12/17',
      median,
      spread: (stats.spreadS as number).toFixed(2),
    });
  });

  it('the grid heads and the table under the lap list read the same numbers', () => {
    const times = sectorSegmentTimes(laps)!;
    const ticks = new Set(less);
    const grid = sessionGrid(times, ticks);
    const table = model(less).sections!;
    const [medians, bests, spreads] = table.footer;
    const stats = segmentBasisStats(times, new Set(ticks));
    grid.columns.forEach((c, i) => {
      expect(medians.cells[i]).toBe((c.medianS as number).toFixed(2));
      expect(bests.cells[i]).toBe((c.bestS as number).toFixed(2));
      // Twelve basis laps need no earlier session: the Varies most block's seconds are the column's own IQR.
      expect(spreads.cells[i]).toBe((stats[i].spreadS as number).toFixed(2));
    });
    const rows = model(less).rows.filter(r => r.kind === 'lap');
    // Every lap row has a cell per section, a lap without times included (an empty cell, not the sector text).
    for (const row of rows)
      expect(row.kind === 'lap' && row.sectionDeltas).toHaveLength(
        table.heads.length,
      );
    // The phone's colour cells are each lap's gap to that same median.
    for (const row of grid.rows) {
      const lapRow = rows.find(r => r.kind === 'lap' && r.lapId === row.lapId);
      expect(lapRow?.kind === 'lap' && lapRow.sectionDeltas).toEqual(
        row.cells.map(cornerCellOf),
      );
    }
  });

  it('the lap gaps, the bars and the detail are against the same median as the strip', () => {
    const m = buildSessionModel(session, laps, {
      laps: less,
      ref: null,
      hl: stint1[0].id,
    });
    const medianS = lapTimeStats(laps.filter(l => less.includes(l.id)))
      .medianS as number;
    const lap = stint1[0];
    expect(m.detail?.status).toContain(`vs median of ${less.length}`);
    const bar = m.chart!.bars.find(b => b.lapId === lap.id)!;
    expect(bar.deltaS).toBeCloseTo(
      Math.max(-1.5, Math.min(1.5, medianS - (lap.timeS as number))),
      9,
    );
  });
});

describe('a one-stint session opens on the numbers it showed before (decision 2026-10-11)', () => {
  // Stint 1 of the fixture as a session of its own: 17 laps, 13 comparable,
  // the stored median the uploader would give (81.938). The opening set is the
  // 13 comparable laps. Every value below was printed by main (de6628c3) for
  // this input; this branch must give the same.
  const full = toSessionDetail(fixture.session);
  const oneStint = laps.filter(l => l.stint === 1);
  const single = {
    ...full,
    stints: full.stints.filter(s => s.n === 1),
    medianTimeS: 81.938,
  };
  const open = openingLapIds(oneStint, single);
  const m = buildSessionModel(single, oneStint, {
    laps: open,
    ref: null,
    hl: null,
  });

  it('opens on the 13 comparable laps', () => {
    expect(open).toHaveLength(13);
  });

  it('table medians, bests and spreads, Optimal, lap gaps, bars and best cells are unchanged', () => {
    expect(m.sections!.footer.map(r => r.cells)).toEqual([
      ['10.20', '42.71', '28.69'],
      ['10.11', '42.08', '28.41'],
      ['0.33', '0.62', '0.27'],
    ]);
    expect(m.optimum[0].value).toBe('1:20.591 · of 13');
    const lapRows = m.rows.filter(r => r.kind === 'lap') as {
      gap: string | null;
      sectors: {best: boolean}[];
    }[];
    expect(lapRows.map(r => r.gap)).toEqual([
      null,
      '+1.752',
      '−0.869',
      '−1.030',
      null,
      '+0.359',
      '+0.309',
      '−1.164',
      '−0.694',
      '±0.000',
      null,
      '+0.525',
      '+1.201',
      '+1.148',
      '−0.046',
      '−0.265',
      null,
    ]);
    expect(m.chart!.bars.map(b => +b.deltaS.toFixed(6))).toEqual([
      0, -1.5, 0.869, 1.03, 0, -0.359, -0.309, 1.164, 0.694, 0, 0, -0.525,
      -1.201, -1.148, 0.046, 0.265, 0,
    ]);
    expect(
      lapRows.map(r => r.sectors.map(c => (c.best ? 1 : 0)).join('')),
    ).toEqual([
      '000',
      '000',
      '000',
      '101',
      '000',
      '000',
      '000',
      '010',
      '000',
      '000',
      '000',
      '000',
      '000',
      '000',
      '000',
      '000',
      '000',
    ]);
  });

  it('Median is now the median lap (was Typical 1:21.605, the sum of sector medians)', () => {
    expect(m.optimum.map(f => f.label)).toEqual([
      'Optimal',
      'Median',
      'Inconsistency',
    ]);
    expect(m.optimum[1].value).toBe('1:21.938 · of 13');
  });
});
