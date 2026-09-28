import {describe, expect, it} from '@jest/globals';

import {toLaps, toTrackMap} from './adapters';
import {firstCornerOf, lapCornerFacts, trackCorners} from './corners';

const map = toTrackMap({
  lengthM: 1000,
  corners: [
    {n: 1, entryM: 100, apexM: 200, exitM: 300, parts: []},
    {
      n: 2,
      entryM: 500,
      apexM: 600,
      exitM: 800,
      parts: [
        {n: 2, entryM: 500, apexM: 560, exitM: 600},
        {n: 3, entryM: 620, apexM: 700, exitM: 800},
      ],
    },
  ],
  outline: {features: []},
});

describe('trackCorners', () => {
  const corners = trackCorners(map);

  it('flattens sections into C1..Cn; a section without parts is one corner', () => {
    expect(corners.map(c => [c.n, c.sectionN, c.partIndex])).toEqual([
      [1, 1, null],
      [2, 2, 0],
      [3, 2, 1],
    ]);
    expect(corners[1].sectionLabel).toBe('S2 (C2–C3)');
    expect(corners[0].sectionLabel).toBe('S1 (C1)');
  });

  it('reads a lap’s facts per corner, from parts when present', () => {
    const [lap] = toLaps([
      {
        id: 'a',
        corners: [
          {segTime: 5, brakeAtM: 150},
          {
            segTime: 9,
            brakeAtM: 480,
            parts: [
              {segTime: 4, brakeAtM: 490},
              {segTime: 5, brakeAtM: 640},
            ],
          },
        ],
      },
    ]);
    expect(lapCornerFacts(lap, corners[0])?.brakeAtM).toBe(150);
    expect(lapCornerFacts(lap, corners[2])?.brakeAtM).toBe(640);
  });

  it('opens a section at its first corner', () => {
    expect(firstCornerOf(corners, 2)).toBe(2);
    expect(firstCornerOf(corners, 9)).toBeNull();
  });
});
