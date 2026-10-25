import {describe, expect, it} from '@jest/globals';

import {basisOf} from '@/src/analysis/lapBasis';
import {segmentTimesFor, topSpreadCorner} from '@/src/data/sessions';
import {laps, map} from '@/src/data/sessions/__fixtures__/spreadSet';

import {sectionTable} from './model';
import {spreadRows, varyOf} from './spreadRows';

// The corner the Corner tab opens on and the first SPREAD row he sees are of
// the same laps: one basis (analysis/lapBasis.ts), one section-to-corner map.
describe('the Corner landing and the first SPREAD row', () => {
  it('agree for the same laps, ticked or not', () => {
    const all = laps(12);
    const track = map();
    const times = segmentTimesFor('turns', all, track);
    expect(times).not.toBeNull();
    for (const ticked of [
      new Set<string>(),
      new Set(all.slice(0, 11).map(l => l.id)),
    ]) {
      const basis = new Set(basisOf(times!.laps, ticked).map(l => l.id));
      const {rows} = spreadRows(
        times,
        basis,
        sectionTable(times, basis, track),
        varyOf(times, basis),
      );
      expect(rows.length).toBeGreaterThan(0);
      const first = rows.find(r => r.corner != null);
      expect(topSpreadCorner(all, track, ticked)).toBe(first?.corner);
    }
  });
});
