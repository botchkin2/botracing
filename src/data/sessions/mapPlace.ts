import {
  applyGeoref,
  canDrawOnRealMap,
  fromLocalMetres,
  LMU_FAKE_ORIGIN,
  toLocalMetres,
} from '@/src/analysis/geo';
import {splitOutline, type OutlineUse} from '@/src/analysis/outlineUse';
import {type GridTrace} from '@/src/analysis/resample';
import {
  dropOsmInsideSurface,
  surfaceGeometry,
  type SurfaceRun,
  type TrackSurface,
} from '@/src/analysis/trackSurface';
import {type TrackMapData} from './adapters';

// Where map points go: on the real (OSM) map when the track's fit is good,
// else in local metres around LMU's fake origin. Shared by Compare (Track and
// Follow) and the Track page.

export type Xy = {x: number; y: number};

/** One stretch of the measured road, in map metres (see MapPlacer.measured). */
export type MeasuredRun = {
  centre: Xy[];
  /** Measured edges per bin, null where the bin has none. */
  left: (Xy | null)[];
  right: (Xy | null)[];
  /** The unmeasured side at the track's median half-width: drawn dashed. */
  leftDashed: (Xy | null)[];
  rightDashed: (Xy | null)[];
  /** Every bin is measured: the road is a loop. */
  closed: boolean;
};

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
  /**
   * OSM track lines in map metres; empty unless real. Where the track has a
   * measured surface the parts of these lines inside it are already gone: the
   * measured road replaces them (src/analysis/trackSurface.ts).
   */
  outline: Xy[][];
  /**
   * The track's measured road (the game's own centre path and asphalt
   * edges), in map metres; empty when the track has none. Drawn in place of
   * the OSM it replaces.
   */
  measured: MeasuredRun[];
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

export function mapPlacer(
  map: TrackMapData | null,
  surface: TrackSurface | null = null,
): MapPlacer {
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
  const placeWorld: MapPlacer['placeWorld'] = points => {
    const pts = points.map(p =>
      fromLocalMetres({x: p.x, y: p.z}, LMU_FAKE_ORIGIN),
    );
    const placed = georef ? applyGeoref(pts, georef) : pts;
    return placed.map(p => toLocalMetres(p, origin));
  };
  const place: MapPlacer['place'] = (t, from, to, stride) => {
    const pts = [];
    for (let i = Math.max(0, from); i <= to && i < t.lat.length; i += stride)
      pts.push({lat: t.lat[i], lon: t.lon[i]});
    const placed = georef ? applyGeoref(pts, georef) : pts;
    return placed.map(p => toLocalMetres(p, origin));
  };
  const osm = georef ? toMetres(map!.outline) : [];
  // The surface is in the game's world metres, placed like a car: the same
  // projection and georef as a trace.
  const placeXy = (pts: {x: number; y: number}[]) =>
    placeWorld(pts.map(p => ({x: p.x, z: p.y})));
  const measured = measuredRuns(surface, placeXy);
  // OSM road ways inside the measured road are replaced by it; pit lanes are
  // a separate list and never touched.
  const outline =
    measured.length > 0 && osm.length > 0
      ? dropOsmInsideSurface(
          // Only racing-layout roads can be replaced; a service or access road
          // keeps whatever kind the map gave it and is never dropped.
          osm.map((points, i) => ({
            id: i,
            kind: map?.outlineKinds?.[i] ?? 'unknown',
            points,
          })),
          {
            runs: measured.map(m => ({...m, fromM: 0})) as SurfaceRun[],
            halfWidthM: surfaceHalfWidth(surface),
            coverage: {bins: 0, both: 0, oneEdge: 0, centreOnly: 0},
          },
        ).flatMap(w => w.kept)
      : osm;
  return {
    measured,
    real: georef != null,
    place,
    placeWorld,
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

function surfaceHalfWidth(surface: TrackSurface | null): number {
  return surface ? surfaceGeometry(surface).halfWidthM ?? 0 : 0;
}

/** The surface's runs, every point placed; empty without one. */
function measuredRuns(
  surface: TrackSurface | null,
  placeXy: (pts: Xy[]) => Xy[],
): MeasuredRun[] {
  if (!surface) return [];
  const placeAll = (pts: (Xy | null)[]): (Xy | null)[] => {
    const at = placeXy(pts.flatMap(p => (p ? [p] : [])));
    let i = 0;
    return pts.map(p => (p ? at[i++] : null));
  };
  return surfaceGeometry(surface).runs.map(run => ({
    centre: placeXy(run.centre),
    left: placeAll(run.left),
    right: placeAll(run.right),
    leftDashed: placeAll(run.leftDashed),
    rightDashed: placeAll(run.rightDashed),
    closed: run.closed,
  }));
}

/**
 * The measured road's centre lines, for a map that draws the road as one thin
 * band (TrackMap): a loop is closed back to its first point.
 */
export function measuredCentreLines(runs: MeasuredRun[]): Xy[][] {
  return runs.map(r =>
    r.closed && r.centre.length > 0 ? [...r.centre, r.centre[0]] : r.centre,
  );
}
