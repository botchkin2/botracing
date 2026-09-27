// Map coordinates for laps.
//
// LMU's GPS channels are not real positions. They are game-world metres
// projected around a fixed fake origin at 60°N 0°E, so plotting raw lat/lon
// as square degrees stretches east–west by 1/cos(60°) = 2×. Converting to
// local metres first gives a correctly shaped map with no other data.
//
// A track's georef (tools/track-fit, stored on tracks/{trackId}) is a rigid
// fit of the game's metres onto the real OpenStreetMap outline: rotation and
// translation, no scale. Applying it puts a lap on real WGS84, so it can be
// drawn over the OSM outline or a satellite tile. Only draw it on a real map
// when the fit's quality is 'good'; otherwise keep the plain local-metres map.
//
// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_EQUATOR = 111320;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Xy {
  // Metres east and north of the origin.
  x: number;
  y: number;
}

export type GeorefQuality = 'good' | 'fair' | 'poor';

export interface Georef {
  fakeOrigin?: LatLon;
  rotationDeg: number;
  mirror: number;
  originLat: number;
  originLon: number;
  fitMedianM?: number;
  fitP90M?: number;
}

// LMU's fake origin. Every LMU recording uses it.
export const LMU_FAKE_ORIGIN: LatLon = {lat: 60, lon: 0};

// Metres east and north of origin, on a local flat projection. Good to well
// under a metre over a race track.
export function toLocalMetres(p: LatLon, origin: LatLon): Xy {
  return {
    x: (p.lon - origin.lon) * M_PER_DEG_LON_EQUATOR * Math.cos((origin.lat * Math.PI) / 180),
    y: (p.lat - origin.lat) * M_PER_DEG_LAT,
  };
}

export function fromLocalMetres(p: Xy, origin: LatLon): LatLon {
  return {
    lat: origin.lat + p.y / M_PER_DEG_LAT,
    lon: origin.lon + p.x / (M_PER_DEG_LON_EQUATOR * Math.cos((origin.lat * Math.PI) / 180)),
  };
}

// A trace's points in local metres around the fake origin: the plain map,
// correct in shape and size, for any track with or without a georef.
export function traceToLocalMetres(points: LatLon[], origin: LatLon = LMU_FAKE_ORIGIN): Xy[] {
  return points.map(p => toLocalMetres(p, origin));
}

// A trace's points on the real map (WGS84), using the track's georef.
export function applyGeoref(points: LatLon[], g: Georef): LatLon[] {
  const fake = g.fakeOrigin ?? LMU_FAKE_ORIGIN;
  const r = (g.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const origin = {lat: g.originLat, lon: g.originLon};
  return points.map(p => {
    const m = toLocalMetres(p, fake);
    const x = m.x * g.mirror;
    return fromLocalMetres({x: x * cos - m.y * sin, y: x * sin + m.y * cos}, origin);
  });
}

// Whether a track may be drawn over a real basemap.
export function canDrawOnRealMap(quality: GeorefQuality | null | undefined, g: Georef | null | undefined): boolean {
  return quality === 'good' && g != null && g.mirror === 1;
}

// Straight-line distance in metres between two real points (local flat
// approximation; fine at track scale).
export function distanceM(a: LatLon, b: LatLon): number {
  const d = toLocalMetres(b, a);
  return Math.hypot(d.x, d.y);
}
