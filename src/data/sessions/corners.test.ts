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

  it('flattens sections into T1..Tn; a section without parts is one corner', () => {
    expect(corners.map(c => [c.n, c.sectionN, c.partIndex])).toEqual([
      [1, 1, null],
      [2, 2, 0],
      [3, 2, 1],
    ]);
    expect(corners[1].sectionLabel).toBe('S2 (T2–T3)');
    expect(corners[0].sectionLabel).toBe('S1 (T1)');
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

describe('toTrackMap outline', () => {
  const line = (kind: string, x: number) => ({
    properties: {kind},
    geometry: {
      type: 'LineString',
      coordinates: [
        [x, 0],
        [x, 1],
      ],
    },
  });
  const m = toTrackMap({
    outline: {features: [line('track', 1), line('pit', 2), line('track', 3)]},
  });

  it('splits the pit lane from the track lines', () => {
    expect(m.outline.map(l => l[0][0])).toEqual([1, 3]);
    expect(m.pitLane).toEqual([
      [
        [2, 0],
        [2, 1],
      ],
    ]);
  });
});
