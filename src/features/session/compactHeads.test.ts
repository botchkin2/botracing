import {describe, expect, it} from '@jest/globals';

import {compactHeads} from './compactHeads';
import {COMPACT_FIXED_W, compactCellW} from './components/CompactLapRow';

describe('compactHeads', () => {
  it('keeps the names as written where they fit', () => {
    expect(compactHeads(['T1', 'T5'], 60)).toEqual(['T1', 'T5']);
  });

  it("is each section's first corner where they do not: T2–4 is 2, T10A–T12 is 10A, S/F is SF", () => {
    expect(compactHeads(['S/F', 'T1', 'T2–4', 'T10A–T12', 'T13'], 16)).toEqual([
      'SF',
      '1',
      '2',
      '10A',
      '13',
    ]);
  });
});

describe('compactCellW', () => {
  it('shares the room the fixed columns leave, so every section fits a 343 pt row', () => {
    for (const count of [3, 9, 13]) {
      const w = compactCellW(343, count);
      expect(w).toBeGreaterThan(0);
      // The fixed columns, then every cell with its 2 pt gap: never past the row.
      expect(COMPACT_FIXED_W + count * (w + 2)).toBeLessThanOrEqual(343);
    }
  });

  it('is the game sector width with no sections', () => {
    expect(compactCellW(343, 0)).toBe(38);
  });
});
