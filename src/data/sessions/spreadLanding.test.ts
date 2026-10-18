import {describe, expect, it} from '@jest/globals';

import {toLaps} from './adapters';
import {lap, laps, map, seg} from './__fixtures__/spreadSet';
import {topSpreadCorner} from './spreadLanding';

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
