import {describe, expect, it} from '@jest/globals';

import {toLaps, toTrackMap} from './adapters';
import {topSpreadCorner} from './spreadLanding';

// A start straight and two sections (corners 1-2 and 3), cut at boundaries.
const boundaries = {
  v: 1,
  rev: 3,
  startsM: [150, 600],
  marginM: [20, 20],
  windows: [
    {kind: 'start-straight', section: null, fromM: 0, toM: 150, parts: []},
    {kind: 'section', section: 1, fromM: 150, toM: 600, parts: []},
    {kind: 'section', section: 3, fromM: 600, toM: 1000, parts: []},
  ],
};
const corner = (n: number, entryM: number) => ({
  n,
  entryM,
  apexM: entryM + 20,
  exitM: entryM + 40,
  parts: [],
});
const map = () =>
  toTrackMap({
    lengthM: 1000,
    boundaries,
    corners: [
      {...corner(1, 200), parts: [corner(1, 200), corner(2, 300)]},
      corner(3, 700),
    ],
    outline: {features: []},
  });

const seg = (time: number, fromM: number, toM: number) => ({
  segTime: time,
  offTrackSec: 0,
  localYellowSec: 0,
  parts: [],
  brakeApps: [],
  fromM,
  toM,
  runInS: time / 4,
  cornerS: time / 2,
  exitS: time / 4,
  pit: false,
});
// Twelve laps: the start straight scatters most (not a section, so skipped),
// section 2 scatters more than section 1.
const lap = (i: number, comparable = true) => ({
  id: `l${i}`,
  lapTime: 100,
  stint: 1,
  comparable,
  reasons: [],
  sectors: [],
  cornerBoundaries: {v: 1, rev: 3},
  startStraight: {
    ...seg(5 + 2 * (i % 4), 0, 150),
    fromM: 0,
    toM: 150,
    pit: false,
  },
  corners: [
    seg(40 + 0.05 * (i % 4), 150, 600),
    seg(55 + 0.4 * (i % 4), 600, 1000),
  ],
  traffic: null,
});
const laps = (n = 12) => toLaps(Array.from({length: n}, (_, i) => lap(i)));

const none = new Set<string>();

describe('topSpreadCorner', () => {
  it('is the first corner of the section with the most spread, never the start straight', () => {
    expect(topSpreadCorner(laps(), map(), none)).toBe(3);
  });

  it('is null without a map, under ten comparable laps, or when the laps are not comparable', () => {
    expect(topSpreadCorner(laps(), null, none)).toBeNull();
    expect(topSpreadCorner(laps(9), map(), none)).toBeNull();
    expect(
      topSpreadCorner(
        toLaps(Array.from({length: 12}, (_, i) => lap(i, false))),
        map(),
        none,
      ),
    ).toBeNull();
  });

  it('reads the laps it is given: the ticked set decides, not the comparable one', () => {
    // 24 laps: the first twelve scatter only in section 3, the last twelve
    // only (and less) in section 1.
    const lapAt = (i: number) => {
      const l = lap(0);
      return {
        ...l,
        id: `m${i}`,
        startStraight: {...l.startStraight, segTime: 5},
        corners: [
          seg(40 + (i >= 12 ? 0.2 * (i % 4) : 0), 150, 600),
          seg(55 + (i < 12 ? 0.4 * (i % 4) : 0), 600, 1000),
        ],
      };
    };
    const mixed = toLaps(Array.from({length: 24}, (_, i) => lapAt(i)));
    const ids = mixed.map(l => l.id);
    expect(topSpreadCorner(mixed, map(), new Set(ids.slice(0, 12)))).toBe(3);
    expect(topSpreadCorner(mixed, map(), new Set(ids.slice(12)))).toBe(1);
    // Nothing ticked reads every comparable lap (the screen's own fallback).
    expect(topSpreadCorner(mixed, map(), none)).toBe(3);
  });
});
