import {describe, expect, it} from '@jest/globals';

import {cornerLayout} from './layout';

describe('cornerLayout', () => {
  it('phone: charts first, then shape, then the laps; seek stays pinned', () => {
    const l = cornerLayout(false);
    expect(l.order.slice(0, 3)).toEqual(['charts', 'shape', 'laps']);
    expect(l.pinnedSeek).toBe(true);
    expect(l.order).not.toContain('spread');
    expect(l.folded).toEqual([]);
  });

  it('wide: shape and table lead the left bar, the spread is folded', () => {
    const l = cornerLayout(true);
    expect(l.order.slice(0, 2)).toEqual(['shape', 'laps']);
    expect(l.order.indexOf('spread')).toBeGreaterThan(l.order.indexOf('laps'));
    expect(l.folded).toEqual(['spread']);
  });
});
