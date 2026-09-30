import {
  applyGeoref,
  canDrawOnRealMap,
  fromLocalMetres,
  LMU_FAKE_ORIGIN,
  toLocalMetres,
} from '@/src/analysis/geo';
import {splitOutline, type OutlineUse} from '@/src/analysis/outlineUse';
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
  /**
   * Game-world points (x east, z north, metres) in map metres: the same
   * projection and georef as a trace's Lat/Lon, so a car from the field lands
   * where a lap driven through it would be drawn.
   */
  placeWorld: (points: {x: number; z: number}[]) => Xy[];
  /** OSM track lines in map metres; empty unless real. */
  outline: Xy[][];
  /** OSM pit lane lines in map metres; empty unless real. */
  pitLane: Xy[][];
  /**
   * The outline split into stretches the trace's lap runs along and the rest,
   * which a map draws at low contrast (src/analysis/outlineUse.ts). Computed
   * once per track map and lap and cached; without a real outline both are
   * empty.
   */
  outlineUse: (trace: GridTrace) => OutlineUse;
};

// One split per (track map, lap): the Compare model is rebuilt on every cursor
// move and would otherwise redo it each time.
const outlineUseCache = new WeakMap<TrackMapData, Map<string, OutlineUse>>();

/** Two laps of a track never share their first sample and length. */
function traceKey(t: GridTrace): string {
  return `${t.lat.length}:${t.lat[0]}:${t.lon[0]}`;
}

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
  const place: MapPlacer['place'] = (t, from, to, stride) => {
    const pts = [];
    for (let i = Math.max(0, from); i <= to && i < t.lat.length; i += stride)
      pts.push({lat: t.lat[i], lon: t.lon[i]});
    const placed = georef ? applyGeoref(pts, georef) : pts;
    return placed.map(p => toLocalMetres(p, origin));
  };
  const outline = georef ? toMetres(map!.outline) : [];
  return {
    real: georef != null,
    place,
    placeWorld: points => {
      const pts = points.map(p =>
        fromLocalMetres({x: p.x, y: p.z}, LMU_FAKE_ORIGIN),
      );
      const placed = georef ? applyGeoref(pts, georef) : pts;
      return placed.map(p => toLocalMetres(p, origin));
    },
    outline,
    pitLane: georef ? toMetres(map!.pitLane) : [],
    outlineUse: trace => {
      if (!georef || map == null) return {used: [], unused: []};
      const key = traceKey(trace);
      const perMap = outlineUseCache.get(map) ?? new Map<string, OutlineUse>();
      outlineUseCache.set(map, perMap);
      const known = perMap.get(key);
      if (known) return known;
      const driven = place(trace, 0, trace.lat.length - 1, 1);
      const split = splitOutline(outline, driven);
      perMap.set(key, split);
      return split;
    },
  };
}
