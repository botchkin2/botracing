import {describe, expect, it} from '@jest/globals';

import {fromLocalMetres, LMU_FAKE_ORIGIN} from '@/src/analysis/geo';
import {addLap, emptySurface} from '@/src/analysis/trackSurface';

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

describe('mapPlacer with a measured surface', () => {
  // A 1,000 m straight east along y = 0 in the game's world metres; a car at
  // lateral 3 m drove it (south of the centre), edges at -6 and +6.
  const surface = (() => {
    const s = emptySurface(1000);
    const lap = {
      distM: [] as number[],
      x: [] as number[],
      y: [] as number[],
      pathLateralM: [] as number[],
      trackEdgeM: [] as number[],
    };
    for (const [pl, te] of [
      [-2, -6],
      [3, 6],
    ]) {
      const l = {
        ...lap,
        distM: [],
        x: [],
        y: [],
        pathLateralM: [],
        trackEdgeM: [],
      } as typeof lap;
      for (let d = 0; d < 1000; d += 5) {
        l.distM.push(d);
        l.x.push(d);
        l.y.push(-pl);
        l.pathLateralM.push(pl);
        l.trackEdgeM.push(te);
      }
      addLap(s, l);
    }
    return s;
  })();

  // With a georef of 0 degrees and the fake origin as its origin, OSM lines
  // in [lon, lat] land on the same metres as the world.
  const georef = {
    rotationDeg: 0,
    mirror: 1,
    originLat: LMU_FAKE_ORIGIN.lat,
    originLon: LMU_FAKE_ORIGIN.lon,
  };
  const lonLat = (x: number, y: number): [number, number] => {
    const p = fromLocalMetres({x, y}, LMU_FAKE_ORIGIN);
    return [p.lon, p.lat];
  };
  const withOsm = (): TrackMapData => ({
    ...map(georef, 'good'),
    // One road way on top of the measured road, one 60 m away.
    outline: [
      [lonLat(0, 2), lonLat(1000, 2)],
      [lonLat(0, 60), lonLat(1000, 60)],
    ],
    pitLane: [[lonLat(0, 4), lonLat(1000, 4)]],
  });

  it('places the measured road like a car: centre on the line, edges across it', () => {
    const placer = mapPlacer(withOsm(), surface);
    expect(placer.measured).toHaveLength(1);
    const run = placer.measured[0];
    expect(run.closed).toBe(true);
    for (const c of run.centre) expect(Math.abs(c.y)).toBeLessThan(0.05);
    // Travelling east, the right edge (+6) is south, the left north.
    expect(run.right[20]?.y).toBeCloseTo(-6, 1);
    expect(run.left[20]?.y).toBeCloseTo(6, 1);
    const viaWorld = placer.placeWorld([{x: run.centre[20].x, z: 0}])[0];
    expect(viaWorld.x).toBeCloseTo(run.centre[20].x, 3);
  });

  it('drops the OSM road inside the measured road, keeps the far one and the pit lane', () => {
    const placer = mapPlacer(withOsm(), surface);
    expect(placer.outline).toHaveLength(1);
    expect(Math.abs(placer.outline[0][0].y - 60)).toBeLessThan(0.5);
    expect(placer.pitLane).toHaveLength(1);
  });

  it('without a surface nothing changes', () => {
    const placer = mapPlacer(withOsm());
    expect(placer.measured).toEqual([]);
    expect(placer.outline).toHaveLength(2);
  });

  it('a track with no fit still places the measured road, as the driven line would be', () => {
    const placer = mapPlacer(null, surface);
    expect(placer.real).toBe(false);
    expect(placer.measured[0].centre[10].x).toBeCloseTo(102.5, 1);
    expect(Math.abs(placer.measured[0].centre[10].y)).toBeLessThan(0.05);
  });
});
