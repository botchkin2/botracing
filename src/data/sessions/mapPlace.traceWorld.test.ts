import {describe, expect, it} from '@jest/globals';

import {type Georef} from '@/src/analysis/geo';
import {type GridTrace} from '@/src/analysis/resample';
import {type TrackMapData} from '@/src/data/sessions/adapters';

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

// A georeffed map: the stored georef of a real track, with a rotation, and
// Sebring's latitude (27 deg), where the flat projection is least like Road
// Atlanta's. A car is placed the same way as a lap, so both must agree.
const georefMap = (georef: Georef) =>
  ({
    quality: 'good',
    georef,
    outline: [],
    pitLane: [],
    outlineKinds: [],
  } as unknown as TrackMapData);
const SEBRING = {originLat: 27.4505, originLon: -81.3495};
const ROAD_ATLANTA = {originLat: 34.1479, originLon: -83.8097};
const sebringTrace = {
  lat: [27.45, 27.4502, 27.4505, 27.4509, 27.4513],
  lon: [-81.35, -81.3498, -81.3495, -81.349, -81.3486],
} as unknown as GridTrace;
const atlantaTrace = {
  lat: [34.1479, 34.1482, 34.1486, 34.149, 34.1494],
  lon: [-83.8097, -83.8093, -83.8089, -83.8084, -83.808],
} as unknown as GridTrace;

describe('traceToWorld on a georeffed track', () => {
  const cases: [string, GridTrace, Georef][] = [
    [
      'Road Atlanta, unrotated',
      atlantaTrace,
      {rotationDeg: 0, mirror: 1, ...ROAD_ATLANTA},
    ],
    [
      'Road Atlanta, rotated 37 deg',
      atlantaTrace,
      {rotationDeg: 37, mirror: 1, ...ROAD_ATLANTA},
    ],
    [
      'Sebring (27 deg), rotated 115 deg',
      sebringTrace,
      {rotationDeg: 115, mirror: 1, ...SEBRING},
    ],
  ];
  for (const [name, t, g] of cases) {
    it(`placeWorld(traceToWorld(t)) equals place(t): ${name}`, () => {
      const p = mapPlacer(georefMap(g));
      expect(p.real).toBe(true);
      const n = t.lat.length - 1;
      const world = p.traceToWorld(t, 0, n, 1).map(q => ({x: q.x, z: q.y}));
      const placed = p.placeWorld(world);
      const direct = p.place(t, 0, n, 1);
      placed.forEach((q, i) => {
        expect(q.x).toBeCloseTo(direct[i].x, 6);
        expect(q.y).toBeCloseTo(direct[i].y, 6);
      });
    });
  }
});
