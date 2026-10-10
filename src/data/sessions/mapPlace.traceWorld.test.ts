import {describe, expect, it} from '@jest/globals';

import {type GridTrace} from '@/src/analysis/resample';

import {mapPlacer} from './mapPlace';

// A trace in lat/lon at Sebring's latitude (27 deg), far from the fake origin.
const trace = {
  lat: [27.45, 27.4502, 27.4505, 27.4509],
  lon: [-81.35, -81.3498, -81.3495, -81.349],
} as unknown as GridTrace;

describe('traceToWorld', () => {
  it('without a georef, placeWorld of the world points equals place', () => {
    const p = mapPlacer(null);
    // World points are x east, y north; placeWorld takes x and z.
    const world = p.traceToWorld(trace, 0, 3, 1).map(q => ({x: q.x, z: q.y}));
    const placed = p.placeWorld(world);
    const direct = p.place(trace, 0, 3, 1);
    expect(placed).toHaveLength(4);
    placed.forEach((q, i) => {
      expect(q.x).toBeCloseTo(direct[i].x, 6);
      expect(q.y).toBeCloseTo(direct[i].y, 6);
    });
  });
});
