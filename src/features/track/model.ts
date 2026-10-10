import {type TrackSurface} from '@/src/analysis/trackSurface';
import {matchCornerNames} from '@/src/analysis/cornerNames';
import {applyGeoref, canDrawOnRealMap} from '@/src/analysis/geo';
import {type GridTrace} from '@/src/analysis/resample';
import {buildTrackMarks, type MapAnchor, type MapMarks} from '@/src/charts';
import {
  mapPlacer,
  measuredCentreAt,
  measuredCentreLines,
  type MeasuredRun,
  type SessionSummary,
  type TrackMapData,
  type Xy,
} from '@/src/data/sessions';
import {type TrackInfo} from '@/src/data/tracks';
import {formatLength, turnLabel} from '@/src/design';

import {buildHistory, type HistoryModel} from './history';
import {sectionHeaderOf} from '@/src/analysis/turnNames';

// Track page view model (Claude Design "Track page" v1 handoff). Pure: the
// layout's bundled facts, its sessions, the track's stored corner map and
// one reference lap in; finished strings and map points out.

export type TrackFact = {label: string; value: string; sub: string | null};

export type TrackCornerRow = {
  n: number;
  /** The circuit's official label when it differs ("T10a"). */
  official: string | null;
  /** OSM name, or null: the row then shows "T7" muted. */
  name: string | null;
  selected: boolean;
};

export type TrackCornerGroup = {title: string | null; rows: TrackCornerRow[]};

export type TrackMapModel = {
  real: boolean;
  outline: Xy[][];
  /** Outline stretches the line does not run along (drawn quietly). */
  outlineFaded: Xy[][];
  pitLane: Xy[][];
  /** The reference lap's line; null until the lap has loaded. */
  line: Xy[] | null;
  marks: MapMarks;
  startFinish: MapAnchor | null;
  /** What placed the badges and S/F: the measured road, the lap, or nothing yet. */
  marksFrom: 'surface' | 'lap' | null;
  /** Shown over the map when there is no reliable outline. */
  note: string | null;
};

export type TrackModel = {
  title: string;
  countryCode: string | null;
  country: string | null;
  facts: TrackFact[];
  corners: TrackCornerGroup[];
  selection: {n: number; label: string} | null;
  map: TrackMapModel | null;
  history: HistoryModel | null;
  about: {text: string; url: string; attribution: string} | null;
  layouts: {trackId: string; name: string; current: boolean}[];
};

export type TrackInputs = {
  trackId: string;
  info: TrackInfo | null;
  layouts: TrackInfo[];
  sessions: SessionSummary[];
  map: TrackMapData | null;
  /** The track's measured road, when it has one. */
  surface?: TrackSurface | null;
  /** Best lap of the newest session drawn on the stored corner map. */
  refTrace: GridTrace | null;
  selectedCorner: number | null;
};

const NO_OUTLINE_NOTE = 'No outline yet: your driven line';

/**
 * The session whose best lap draws the page's map and names its corners:
 * the newest one on the track's stored corner map. A session analysed with
 * a map of its own never is. Sessions from before the source was listed
 * (null) count only when no session says 'stored' or 'new'.
 */
export function referenceSession(
  sessions: SessionSummary[],
): SessionSummary | null {
  const newest = (list: SessionSummary[]) =>
    [...list].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
  const timed = sessions.filter(s => s.bestLapId != null);
  return (
    newest(
      timed.filter(
        s => s.cornerMapSource === 'stored' || s.cornerMapSource === 'new',
      ),
    ) ?? newest(timed.filter(s => s.cornerMapSource == null))
  );
}

export function buildTrackModel(input: TrackInputs): TrackModel {
  const {info, map, refTrace, selectedCorner} = input;
  const sessionName = input.sessions[0]?.track;
  // The map is a map: its outline draws without a lap; the lap adds its layers.
  const mapModel = map ? placeMap(map, input.surface ?? null, refTrace) : null;

  const names = new Map<number, string>();
  const corners = map
    ? map.sections.flatMap(s => (s.parts.length ? s.parts : [s]))
    : [];
  if (map && refTrace && mapModel) {
    if (info && map.georef && canDrawOnRealMap(map.quality, map.georef)) {
      const georef = map.georef;
      const apexes = corners.map(c => {
        const i = gridIndex(refTrace, c.apexM);
        const [p] = applyGeoref(
          [{lat: refTrace.lat[i], lon: refTrace.lon[i]}],
          georef,
        );
        return {n: c.n, ...p};
      });
      for (const [n, name] of matchCornerNames(apexes, info.osmNames)) {
        names.set(n, name);
      }
    }
  }

  const row = (c: {
    n: number;
    official?: string;
    apexM: number;
  }): TrackCornerRow => ({
    n: c.n,
    official: c.official ?? null,
    name: names.get(c.n) ?? null,
    selected: c.n === selectedCorner,
  });
  const groups: TrackCornerGroup[] = [];
  for (const s of map?.sections ?? []) {
    if (s.parts.length > 1) {
      const label = sectionHeaderOf(
        s.parts.map(p => turnLabel(p.n, p.official)),
      );
      groups.push({
        title: `S${s.n} · ${label.toUpperCase()}`,
        rows: s.parts.map(row),
      });
      continue;
    }
    const last = groups[groups.length - 1];
    const r = row(s.parts[0] ?? s);
    if (last && last.title == null) last.rows.push(r);
    else groups.push({title: null, rows: [r]});
  }

  const picked = corners.find(c => c.n === selectedCorner);
  const pickedName = picked ? names.get(picked.n) : undefined;

  return {
    title: info?.layout ?? sessionName ?? input.trackId,
    countryCode: info?.countryCode ?? null,
    country: info?.country ?? null,
    facts: buildFacts(info, map),
    corners: groups,
    selection: picked
      ? {
          n: picked.n,
          label: `${turnLabel(picked.n, picked.official)}${
            pickedName ? ` ${pickedName}` : ''
          }`,
        }
      : null,
    map: mapModel,
    history: buildHistory(input.sessions),
    about: info?.summary
      ? {
          text: info.summary.extract,
          url: info.summary.url,
          attribution: info.summary.attribution,
        }
      : null,
    layouts: input.layouts.map(l => ({
      trackId: l.trackId,
      name: l.layout,
      current: l.trackId === input.trackId,
    })),
  };
}

function buildFacts(
  info: TrackInfo | null,
  map: TrackMapData | null,
): TrackFact[] {
  const facts: TrackFact[] = [];
  const lengthM =
    info?.lengthM ?? (map && map.lengthM > 0 ? map.lengthM : null);
  if (lengthM != null) {
    const len = formatLength(lengthM);
    facts.push({label: 'Length', value: len.km, sub: len.mi});
  }
  if (info?.openedYear != null) {
    facts.push({label: 'Opened', value: String(info.openedYear), sub: null});
  }
  if (info?.place)
    facts.push({label: 'Location', value: info.place, sub: null});
  return facts;
}

function gridIndex(t: GridTrace, m: number): number {
  const n = t.lat.length;
  const i = Math.round(m / t.stepM) % n;
  return i < 0 ? i + n : i;
}

function placeMap(
  map: TrackMapData,
  surface: TrackSurface | null,
  t: GridTrace | null,
): TrackMapModel | null {
  const placer = mapPlacer(map, surface);
  const lap = t && t.lat.length >= 3 ? t : null;
  const line = lap ? placer.place(lap, 0, lap.lat.length - 1, 1) : null;
  // The badges and S/F sit on the measured road when it covers every place
  // they need, so a map is a map with no lap (thread 1 #3479); else on the lap.
  const fromSurface = surfaceMarks(map, surface, placer.measured);
  const fromLap =
    lap && line && !fromSurface
      ? lapMarks(map, lap, (m: number) => line[gridIndex(lap, m)])
      : null;
  const marks = fromSurface ?? fromLap;
  const split = lap ? placer.outlineUse(lap) : null;
  const outline = [
    ...measuredCentreLines(placer.measured),
    ...(split ? split.used : placer.outline),
  ];
  if (outline.length === 0 && !line) return null;
  return {
    real: placer.real,
    outline,
    outlineFaded: split ? split.unused : placer.nearMeasured,
    pitLane: placer.pitLane,
    line,
    // Numbers only: the page has no section labels or boundary ticks.
    marks: {boundaries: [], sections: [], corners: marks?.corners ?? []},
    startFinish: marks?.startFinish ?? null,
    marksFrom: fromSurface ? 'surface' : fromLap ? 'lap' : null,
    note: line && !placer.real ? NO_OUTLINE_NOTE : null,
  };
}

type PlacedMarks = {corners: MapMarks['corners']; startFinish: MapAnchor};

function marksAlong(
  map: TrackMapData,
  lengthM: number,
  pointAt: (m: number) => Xy,
): PlacedMarks {
  const all = buildTrackMarks(map.sections, lengthM, pointAt);
  return {
    corners: all.corners,
    startFinish: {at: pointAt(0), prev: pointAt(-10), next: pointAt(10)},
  };
}

function lapMarks(
  map: TrackMapData,
  t: GridTrace,
  pointAt: (m: number) => Xy,
): PlacedMarks {
  return marksAlong(
    map,
    map.lengthM || t.distanceM[t.distanceM.length - 1],
    pointAt,
  );
}

/** Marks on the measured road, or null when it misses any place they need. */
function surfaceMarks(
  map: TrackMapData,
  surface: TrackSurface | null,
  runs: MeasuredRun[],
): PlacedMarks | null {
  if (!surface || runs.length === 0 || !(map.lengthM > 0)) return null;
  let missing = false;
  const pointAt = (m: number): Xy => {
    const p = measuredCentreAt(surface, runs, m / map.lengthM);
    if (!p) missing = true;
    return p ?? {x: 0, y: 0};
  };
  const marks = marksAlong(map, map.lengthM, pointAt);
  return missing ? null : marks;
}
