import {describe, expect, it} from '@jest/globals';

import {sectionOptimum} from '@/src/analysis/sectionOptimum';
import {type SegmentTimes} from '@/src/analysis/segments';
// Adapters are internal to data/; tests may reach them to build real shapes.
import {sectorSegmentTimes} from '@/src/data/sessions';
import {toLaps, toSessionDetail} from '@/src/data/sessions/adapters';
import {formatLapTime} from '@/src/design';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {buildStintTable} from './desktopModel';
import {sessionGrid} from './grid';
import {buildSessionModel} from './model';
import {
  basisOf,
  lapTimeStats,
  segmentBasisStats,
  stintNumbers,
} from './selectionStats';

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

describe('basisOf', () => {
  it('is the ticked laps, comparable or not; the comparable ones when none is ticked', () => {
    expect(basisOf(laps, new Set([laps[0].id])).map(l => l.id)).toEqual([
      laps[0].id,
    ]);
    expect(basisOf(laps, new Set())).toHaveLength(16);
  });
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
    // The session facts do not move: they are what happened.
    expect(after.facts).toEqual(before.facts);
  });

  it('the stint line, the Median fact and the Stints panel give one median, IQR and count', () => {
    const m = model(less);
    const picked = stint1.filter(l => l.id !== worst.id);
    const stats = lapTimeStats(picked);
    const median = formatLapTime(stats.medianS as number);
    const stint = m.rows.find(r => r.kind === 'stint');
    expect(stint).toMatchObject({
      label: expect.stringContaining(
        `med ${median} · IQR ${(stats.spreadS as number).toFixed(2)} s · of 12`,
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
    const [medians, bests, iqrs] = table.footer;
    grid.columns.forEach((c, i) => {
      expect(medians.cells[i]).toBe((c.medianS as number).toFixed(2));
      expect(bests.cells[i]).toBe((c.bestS as number).toFixed(2));
      expect(iqrs.cells[i]).toBe((c.spreadS as number).toFixed(2));
    });
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
