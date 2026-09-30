import {cornerTurn, type CornerTurn} from '@/src/analysis/cornerShape';
import {matchCornerNames} from '@/src/analysis/cornerNames';
import {applyGeoref, canDrawOnRealMap} from '@/src/analysis/geo';
import {type GridTrace} from '@/src/analysis/resample';
import {buildTrackMarks, type MapAnchor, type MapMarks} from '@/src/charts';
import {
  mapPlacer,
  type SessionSummary,
  type TrackMapData,
  type Xy,
} from '@/src/data/sessions';
import {type TrackInfo} from '@/src/data/tracks';
import {formatDistance, formatLength, turnLabel} from '@/src/design';

import {buildHistory, type HistoryModel} from './history';

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
  turn: string | null;
  dist: string;
  selected: boolean;
};

export type TrackCornerGroup = {title: string | null; rows: TrackCornerRow[]};

export type TrackMapModel = {
  real: boolean;
  outline: Xy[][];
  pitLane: Xy[][];
  line: Xy[];
  marks: MapMarks;
  startFinish: MapAnchor | null;
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
  /** Best lap of the newest session drawn on the stored corner map. */
  refTrace: GridTrace | null;
  selectedCorner: number | null;
};

const TURN_LABEL: Record<CornerTurn, string> = {
  L: 'Left',
  R: 'Right',
  'L-R': 'L-R',
  'R-L': 'R-L',
};

const NO_OUTLINE_NOTE =
  'No reliable outline for this layout yet, so this shows your driven line.';

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
  const shape = map && refTrace ? placeLine(map, refTrace) : null;

  const names = new Map<number, string>();
  const turns = new Map<number, string>();
  const corners = map
    ? map.sections.flatMap(s => (s.parts.length ? s.parts : [s]))
    : [];
  if (map && refTrace && shape) {
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
    const line = {
      stepM: refTrace.stepM,
      x: shape.line.map(p => p.x),
      y: shape.line.map(p => p.y),
    };
    for (const c of corners) turns.set(c.n, TURN_LABEL[cornerTurn(line, c)]);
  }

  const row = (c: {
    n: number;
    official?: string;
    apexM: number;
  }): TrackCornerRow => ({
    n: c.n,
    official: c.official ?? null,
    name: names.get(c.n) ?? null,
    turn: turns.get(c.n) ?? null,
    dist: formatDistance(c.apexM),
    selected: c.n === selectedCorner,
  });
  const groups: TrackCornerGroup[] = [];
  for (const s of map?.sections ?? []) {
    if (s.parts.length > 1) {
      const partNames = s.parts.map(p => names.get(p.n));
      const label = partNames.every(Boolean)
        ? partNames.join('–').toUpperCase()
        : `${turnLabel(s.parts[0].n, s.parts[0].official)}–${turnLabel(
            s.parts[s.parts.length - 1].n,
            s.parts[s.parts.length - 1].official,
          )}`;
      groups.push({title: `S${s.n} · ${label}`, rows: s.parts.map(row)});
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
    facts: buildFacts(info, map, corners.length),
    corners: groups,
    selection: picked
      ? {
          n: picked.n,
          label: `${turnLabel(picked.n, picked.official)}${
            pickedName ? ` ${pickedName}` : ''
          } · ${formatDistance(picked.apexM)}`,
        }
      : null,
    map: map && shape ? shape.model : null,
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
  cornerCount: number,
): TrackFact[] {
  const facts: TrackFact[] = [];
  const lengthM =
    info?.lengthM ?? (map && map.lengthM > 0 ? map.lengthM : null);
  if (lengthM != null) {
    const len = formatLength(lengthM);
    facts.push({label: 'Length', value: len.km, sub: len.mi});
  }
  if (cornerCount > 0) {
    facts.push({
      label: 'Turns',
      value: String(cornerCount),
      sub: 'From the corner map',
    });
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

function placeLine(
  map: TrackMapData,
  t: GridTrace,
): {line: Xy[]; model: TrackMapModel} | null {
  if (t.lat.length < 3) return null;
  const placer = mapPlacer(map);
  const line = placer.place(t, 0, t.lat.length - 1, 1);
  const pointAt = (m: number) => line[gridIndex(t, m)];
  const all = buildTrackMarks(
    map.sections,
    map.lengthM || t.distanceM[t.distanceM.length - 1],
    pointAt,
  );
  return {
    line,
    model: {
      real: placer.real,
      outline: placer.outline,
      pitLane: placer.pitLane,
      line,
      // Numbers only: the page has no section labels or boundary ticks.
      marks: {boundaries: [], sections: [], corners: all.corners},
      startFinish: {at: pointAt(0), prev: pointAt(-10), next: pointAt(10)},
      note: placer.real ? null : NO_OUTLINE_NOTE,
    },
  };
}
