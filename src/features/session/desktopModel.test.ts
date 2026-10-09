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
  const rows = buildStintTable(session, laps);

  it('one row per stint from the stored stint stats', () => {
    expect(
      rows.map(r => [r.name, r.count, r.median, r.best, r.spread]),
    ).toEqual([
      ['Stint 1', '13/17', '1:21.938', '1:20.774', '0.91'],
      ['Stint 2', '3/5', '1:21.481', '1:20.763', '0.66'],
    ]);
  });

  it('fall-off only where the session doc stores a trend', () => {
    expect(rows[0].detail).toBe('L1–L17');
    expect(rows[1].detail).toBe('L18–L22 · fall-off ±0.000 s/lap');
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
