import {describe, expect, it} from '@jest/globals';

// Adapters are internal to data/; tests may reach them to build real shapes.
import {toLaps, toSessionDetail} from '@/src/data/sessions/adapters';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {buildStintTable, buildStintVsStint, median} from './desktopModel';

// Road Atlanta race, 2026-09-26: 22 laps, stint 1 = L1–L17, stint 2 = L18–L22.
// consistency.stints only stores stint 2 (trendPerLap 0).
const session = toSessionDetail(fixture.session);
const laps = toLaps(fixture.laps);

describe('median', () => {
  it('odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('buildStintTable', () => {
  const rows = buildStintTable(session, laps, new Set());

  it('with nothing ticked, one row per stint over its comparable laps; spread is the IQR', () => {
    // Recomputed from the fixture's lap times: stint 1's 13 comparable laps
    // have p75 − p25 = 1.219 s (their standard deviation, shown before, 0.91).
    expect(
      rows.map(r => [r.name, r.count, r.median, r.best, r.spread]),
    ).toEqual([
      ['Stint 1', '13/17', '1:21.938', '1:20.774', '1.22'],
      ['Stint 2', '3/5', '1:21.481', '1:20.763', '0.66'],
    ]);
  });

  it('follows the ticks: count, median, best and IQR are of the ticked laps', () => {
    const fastest = laps
      .filter(l => l.stint === 1 && l.comparable && l.timeS != null)
      .sort((a, b) => (a.timeS as number) - (b.timeS as number))
      .slice(0, 5);
    const [s1, s2] = buildStintTable(
      session,
      laps,
      new Set(fastest.map(l => l.id)),
    );
    expect(s1.count).toBe('5/17');
    expect(s1.best).toBe('1:20.774');
    expect(s2).toMatchObject({count: '0/5', median: '—', spread: '—'});
  });

  it('gives the laps of the stint and no fall-off', () => {
    expect(rows[0].detail).toBe('L1–L17');
    expect(rows[1].detail).toBe('L18–L22');
  });
});

describe('buildStintVsStint', () => {
  const corners = Array.from({length: 11}, (_, i) => ({
    n: i + 1,
    apexM: 100 * (i + 1),
  }));
  const m = buildStintVsStint(laps, corners)!;

  it('one row per corner part, stint 2 minus stint 1', () => {
    expect(m.title).toBe('Stint 2 vs Stint 1');
    expect(m.rows).toHaveLength(11);
    expect(m.rows[0]).toMatchObject({label: 'T1', dist: '100 m'});
  });

  it('bars scale to the largest difference; Σ is the sum', () => {
    expect(Math.max(...m.rows.map(r => r.frac))).toBe(1);
    const sum = m.rows.reduce((s, r) => s + r.deltaS, 0);
    expect(m.total).toBe(
      `${sum > 0 ? '+' : sum < 0 ? '−' : '±'}${Math.abs(sum).toFixed(3)}`,
    );
  });

  it('matches a hand median for corner 1', () => {
    const c1 = (stint: number) =>
      median(
        laps
          .filter(l => l.stint === stint && l.comparable)
          .map(l => l.sections[0].parts[0].segTimeS as number),
      )!;
    expect(m.rows[0].deltaS).toBeCloseTo(c1(2) - c1(1), 9);
  });

  it('numbers corners by position when the map does not match', () => {
    expect(buildStintVsStint(laps, null)!.rows[10]).toMatchObject({
      label: 'T11',
      dist: null,
    });
  });

  it('null with only one stint', () => {
    expect(
      buildStintVsStint(
        laps.filter(l => l.stint === 1),
        null,
      ),
    ).toBeNull();
  });
});
