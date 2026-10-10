import {describe, expect, it} from '@jest/globals';

import {toTrackMap} from '@/src/data/sessions/adapters';

import mapJson from '@/src/data/sessions/__fixtures__/roadAtlantaMap.json';

import {sectionTable} from './model';

// Road Atlanta: S1 is T1, S2 the compound T2–5, S3 T6, S4 the compound T7,
// S5 the compound T10a–T12. The start straight has no corner.
describe('sectionTable on Road Atlanta (roadAtlantaGt3)', () => {
  it('maps each column to its section first corner; compound sections are whole', () => {
    const map = toTrackMap(mapJson);
    // One column per boundary window, as the turns grid builds them.
    const times = {
      segments: map.boundaries!.windows.map(w => ({
        label: w.kind === 'start-straight' ? 'S/F' : `S${w.section}`,
        range: {fromM: w.fromM, toM: w.toM},
        section: w.kind === 'start-straight' ? null : w.section,
      })),
      laps: [],
    };
    const table = sectionTable(times, map)!;
    expect(table.targets.map(t => t.corner)).toEqual([null, 1, 2, 6, 7, 9]);
    expect(table.targets.map(t => t.whole)).toEqual([
      false,
      false,
      true,
      false,
      true,
      true,
    ]);
  });
});
