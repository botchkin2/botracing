import {describe, expect, it} from '@jest/globals';

import {fromLocalMetres, LMU_FAKE_ORIGIN} from '@/src/analysis/geo';

import {type TrackMapData} from './adapters';
import {mapPlacer} from './mapPlace';

const world = [
  {x: 0, z: 0},
  {x: 100, z: 0},
  {x: 0, z: 200},
  {x: -350, z: 1200},
];

function map(georef: TrackMapData['georef'], quality: 'good' | 'poor') {
  return {
    lengthM: 1000,
    sections: [],
    quality,
    georef,
    outline: [],
    pitLane: [],
    attribution: null,
  } satisfies TrackMapData;
}

describe('mapPlacer.placeWorld', () => {
  it('without a fit, world x/z is the plain local map (x east, z north)', () => {
    const placed = mapPlacer(null).placeWorld(world);
    placed.forEach((p, i) => {
      expect(p.x).toBeCloseTo(world[i].x, 3);
      expect(p.y).toBeCloseTo(world[i].z, 3);
    });
  });

  it('lands where a trace through the same points would be drawn', () => {
    // A trace is Lat/Lon around the fake origin; the field is world metres.
    // Both must go through the same projection and georef.
    const georef = {
      rotationDeg: 30,
      mirror: 1,
      originLat: 29.19,
      originLon: -81.07,
    };
    const placer = mapPlacer(map(georef, 'good'));
    expect(placer.real).toBe(true);
    const viaWorld = placer.placeWorld(world);
    const latLon = world.map(p =>
      fromLocalMetres({x: p.x, y: p.z}, LMU_FAKE_ORIGIN),
    );
    const viaTrace = placer.place(
      {
        lat: latLon.map(p => p.lat),
        lon: latLon.map(p => p.lon),
      } as never,
      0,
      latLon.length - 1,
      1,
    );
    viaWorld.forEach((p, i) => {
      expect(p.x).toBeCloseTo(viaTrace[i].x, 6);
      expect(p.y).toBeCloseTo(viaTrace[i].y, 6);
    });
    // A rotation by 30° about the fake origin: (100, 0) → (86.6, 50).
    const rotated = placer.placeWorld([{x: 100, z: 0}])[0];
    const origin = placer.placeWorld([{x: 0, z: 0}])[0];
    expect(rotated.x - origin.x).toBeCloseTo(100 * Math.cos(Math.PI / 6), 1);
    expect(rotated.y - origin.y).toBeCloseTo(100 * Math.sin(Math.PI / 6), 1);
  });

  it('a poor fit is not applied', () => {
    const georef = {
      rotationDeg: 90,
      mirror: 1,
      originLat: 29.19,
      originLon: -81.07,
    };
    const placer = mapPlacer(map(georef, 'poor'));
    expect(placer.real).toBe(false);
    const p = placer.placeWorld([{x: 100, z: 0}])[0];
    expect(p.x).toBeCloseTo(100, 3);
    expect(p.y).toBeCloseTo(0, 3);
  });
});
