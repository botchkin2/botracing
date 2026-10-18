import {describe, expect, it} from '@jest/globals';

import {cornerLayout} from './layout';

describe('cornerLayout', () => {
  it('phone: charts first, then the moves card, shape, the laps and the dot strips; seek stays pinned', () => {
    const l = cornerLayout(false);
    expect(l.order.slice(0, 5)).toEqual([
      'charts',
      'moves',
      'shape',
      'laps',
      'strips',
    ]);
    expect(l.pinnedSeek).toBe(true);
    expect(l.order.indexOf('spread')).toBeGreaterThan(
      l.order.indexOf('strips'),
    );
    // The strips are charts: never folded (Botkin, 2 Oct screenshots).
    expect(l.folded).toEqual(['spread']);
    expect(l.folded).not.toContain('strips');
  });

  it('wide: the moves card, shape and table lead the left bar, then the strips; only the spread is folded', () => {
    const l = cornerLayout(true);
    expect(l.order.slice(0, 4)).toEqual(['moves', 'shape', 'laps', 'strips']);
    expect(l.order.indexOf('spread')).toBeGreaterThan(
      l.order.indexOf('strips'),
    );
    expect(l.folded).toEqual(['spread']);
  });
});
