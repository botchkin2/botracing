import {
  applyGeoref,
  canDrawOnRealMap,
  LMU_FAKE_ORIGIN,
  toLocalMetres,
} from '@/src/analysis/geo';
import {type GridTrace} from '@/src/analysis/resample';
import {type TrackMapData} from './adapters';

// Where map points go: on the real (OSM) map when the track's fit is good,
// else in local metres around LMU's fake origin. Shared by Compare (Track and
// Follow) and the Track page.

export type Xy = {x: number; y: number};

export type MapPlacer = {
  real: boolean;
  /** Samples from..to (inclusive) of a trace, every stride, in map metres. */
  place: (t: GridTrace, from: number, to: number, stride: number) => Xy[];
  /** OSM track lines in map metres; empty unless real. */
  outline: Xy[][];
  /** OSM pit lane lines in map metres; empty unless real. */
  pitLane: Xy[][];
};

export function mapPlacer(map: TrackMapData | null): MapPlacer {
  const georef =
    map != null && canDrawOnRealMap(map.quality, map.georef)
      ? map.georef
      : null;
  const origin = georef
    ? {lat: georef.originLat, lon: georef.originLon}
    : LMU_FAKE_ORIGIN;
  const toMetres = (lines: [number, number][][]) =>
    lines.map(line =>
      line.map(([lon, lat]) => toLocalMetres({lat, lon}, origin)),
    );
  return {
    real: georef != null,
    place: (t, from, to, stride) => {
      const pts = [];
      for (let i = Math.max(0, from); i <= to && i < t.lat.length; i += stride)
        pts.push({lat: t.lat[i], lon: t.lon[i]});
      const placed = georef ? applyGeoref(pts, georef) : pts;
      return placed.map(p => toLocalMetres(p, origin));
    },
    outline: georef ? toMetres(map!.outline) : [],
    pitLane: georef ? toMetres(map!.pitLane) : [],
  };
}
