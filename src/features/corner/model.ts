import {toLocalMetres} from '@/src/analysis/geo';
import {type GridTrace, gridIndex} from '@/src/analysis/resample';
import {
  type Lap,
  lapCornerFacts,
  type SessionBand,
  type SessionDetail,
  type TrackMapData,
  trackCorners,
} from '@/src/data/sessions';
import {
  formatDistance,
  formatGap,
  lapMode,
  type LapMode,
  turnLabel,
  turnNumber,
} from '@/src/design';

import {buildStrips, type StripModel} from './strips';

// Corner screen view model (handoff §4, D3), per single corner (T1..Tn).
// Every lap doc carries facts per corner (sections' parts): time from the
// corner's entry to the next corner's entry, brake point, minimum speed and
// full-throttle point. Pure: data and the URL selection in,
// everything the screen draws out. Colors are left to the screen (selIndex).

export type CornerSelection = {
  /** Lap ids in selection order; the first is the reference. */
  laps: string[];
  hl: string | null;
};

export type Measure = 'time' | 'brake' | 'minSpeed' | 'throttle';

export const MEASURES: {
  id: Measure;
  label: string;
  unit: string;
  /** For the gap color and sort: which direction is better. */
  better: 'lower' | 'higher';
}[] = [
  {id: 'time', label: 'Time in corner', unit: 's', better: 'lower'},
  {id: 'brake', label: 'Brake point', unit: 'm before apex', better: 'lower'},
  {id: 'minSpeed', label: 'Min speed', unit: 'km/h', better: 'higher'},
  {
    id: 'throttle',
    label: 'Full throttle',
    unit: 'm after apex',
    better: 'lower',
  },
];

export type CornerRow = {
  lapId: string;
  label: string;
  selIndex: number;
  isRef: boolean;
  highlighted: boolean;
  /** Colour slot when the lap is on (0 = reference), else null. */
  onIndex: number | null;
  values: Record<Measure, number | null>;
  cells: Record<Measure, {value: string; gap: string | null; better: boolean}>;
};

export type ZoomLine = {
  lapId: string;
  selIndex: number;
  highlighted: boolean;
  onIndex: number | null;
  key: boolean;
  speedKph: number[];
  brakePct: number[];
  throttlePct: number[];
  /** Absolute distances of this lap's brake and full-throttle points. */
  brakeAtM: number | null;
  fullThrottleAtM: number | null;
};

export type CornerModel = {
  corner: number;
  /** The section this corner belongs to (Compare opens sections). */
  sectionN: number;
  /** Every corner, for the chips: its number and display label. */
  corners: {n: number; label: string}[];
  title: string;
  subtitle: string;
  mode: LapMode;
  explainer: string;
  rows: CornerRow[];
  strips: StripModel[] | null;
  highlightLine: string | null;
  zoom: {
    windowM: [number, number];
    apexM: number;
    lines: ZoomLine[];
    band: {speed: [number[], number[]]} | null;
    stepM: number;
  };
  /** Desktop braking map; null until the reference lap's trace loads. */
  brakeMap: BrakeMapModel | null;
  prev: number | null;
  next: number | null;
};

// Zoomed traces: 250 m before the apex to 150 m after (handoff §4).
export const ZOOM_BEFORE_M = 250;
export const ZOOM_AFTER_M = 150;
// Strips start where the table's individual lap colours end (lapMode: 7+ laps),
// so a 16-lap race gets them; below that the table shows every lap.
const STRIP_MODE_FROM = 7;

const fmt: Record<Measure, (v: number) => string> = {
  time: v => v.toFixed(3),
  brake: v => `${Math.round(v)}`,
  minSpeed: v => `${Math.round(v)}`,
  throttle: v => `${Math.round(v)}`,
};

/** Laps shown in Corner: the selection, or every comparable lap when asked. */
export function cornerLapIds(
  laps: Lap[],
  selection: CornerSelection,
  allComparable: boolean,
  bestLapId: string | null = null,
): string[] {
  if (!allComparable) {
    if (selection.laps.length > 0) return selection.laps;
    return defaultCornerLaps(laps, bestLapId);
  }
  // With nothing selected, the session's best lap is the reference.
  const ref = selection.laps[0] ?? bestLapId ?? undefined;
  const rest = laps.filter(l => l.comparable && l.id !== ref).map(l => l.id);
  return ref ? [ref, ...rest] : rest;
}

/**
 * Nothing selected and no URL laps: the best lap as reference plus the
 * fastest other comparable lap, so the screen never waits on an empty list.
 */
function defaultCornerLaps(laps: Lap[], bestLapId: string | null): string[] {
  const comparable = laps.filter(l => l.comparable && l.timeS != null);
  const ref =
    bestLapId && laps.some(l => l.id === bestLapId)
      ? bestLapId
      : comparable.slice().sort((a, b) => a.timeS! - b.timeS!)[0]?.id;
  if (!ref) return [];
  const second = comparable
    .filter(l => l.id !== ref)
    .sort((a, b) => a.timeS! - b.timeS!)[0];
  return second ? [ref, second.id] : [ref];
}

/**
 * Definition copy. Some stored parts have the apex on the segment edge
 * (entry = apex, or apex = exit); print equal points once, not as if distinct.
 */
export function cornerExplainer(
  sec: {entryM: number; apexM: number; exitM: number},
  nextEntry: {entryM: number},
): string {
  const apex = formatDistance(sec.apexM);
  const next = `the next corner's entry (${formatDistance(nextEntry.entryM)})`;
  const span =
    sec.apexM === sec.entryM
      ? `this corner's entry, which is also its apex (${apex}), to ${next}`
      : `this corner's entry (${formatDistance(sec.entryM)}) to ${next}`;
  const apexRef = sec.apexM === sec.entryM ? 'the apex' : `the apex (${apex})`;
  const edge =
    sec.apexM === sec.exitM && sec.apexM !== sec.entryM
      ? ' The apex is at the corner’s exit.'
      : '';
  return `Time in corner runs from ${span}, the same stretch of track for every lap. Brake point is metres before ${apexRef}; full throttle is metres after it.${edge}`;
}

export function buildCornerModel(input: {
  session: SessionDetail;
  laps: Lap[];
  map: TrackMapData;
  band: SessionBand | null;
  traces: Map<string, GridTrace>;
  lapIds: string[];
  /** Laps on, in colour order (keyLaps.ts). */
  keyLapIds: string[];
  hl: string | null;
  corner: number;
}): CornerModel | null {
  const {session, laps, map, band, traces, lapIds, corner} = input;
  const onIndexOf = new Map(input.keyLapIds.map((id, i) => [id, i]));
  const all = trackCorners(map);
  const idx = all.findIndex(c => c.n === corner);
  if (idx < 0) return null;
  const sec = all[idx];
  const nextSec = all[(idx + 1) % all.length];
  const byId = new Map(laps.map(l => [l.id, l]));
  const selected = lapIds
    .map(id => byId.get(id))
    .filter((l): l is Lap => l != null);
  const ref = selected[0];
  const mode = lapMode(selected.length);
  const hl =
    input.hl && lapIds.includes(input.hl) ? input.hl : selected[1]?.id ?? null;

  const valuesOf = (l: Lap): Record<Measure, number | null> => {
    const f = lapCornerFacts(l, sec);
    return {
      time: f?.segTimeS ?? null,
      brake: f?.brakeAtM == null ? null : sec.apexM - f.brakeAtM,
      minSpeed: f?.minSpeedKph ?? null,
      throttle:
        f?.fullThrottleAtM == null ? null : f.fullThrottleAtM - sec.apexM,
    };
  };
  const refValues = ref ? valuesOf(ref) : null;

  const rows: CornerRow[] = selected.map((l, i) => {
    const values = valuesOf(l);
    const cells = Object.fromEntries(
      MEASURES.map(m => {
        const v = values[m.id];
        const r = refValues?.[m.id];
        const d = v != null && r != null && i > 0 ? v - r : null;
        return [
          m.id,
          {
            value: v == null ? '—' : fmt[m.id](v),
            gap:
              d == null
                ? null
                : m.id === 'time'
                ? formatGap(d)
                : `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(
                    Math.round(d),
                  )}`,
            better: d != null && (m.better === 'lower' ? d < 0 : d > 0),
          },
        ];
      }),
    ) as CornerRow['cells'];
    return {
      lapId: l.id,
      label: `L${l.lapIndex}`,
      selIndex: i,
      isRef: i === 0,
      highlighted: l.id === hl,
      onIndex: onIndexOf.get(l.id) ?? null,
      values,
      cells,
    };
  });

  const strips: StripModel[] | null =
    selected.length >= STRIP_MODE_FROM
      ? buildStrips(
          rows.map(r => {
            const f = lapCornerFacts(byId.get(r.lapId) as Lap, sec);
            return {
              lapId: r.lapId,
              label: r.label,
              onIndex: r.onIndex,
              timeS: r.values.time,
              brakeM: r.values.brake,
              minSpeedKph: r.values.minSpeed,
              minSpeedAtEdge: f?.minSpeedAtEdge ?? false,
              throttleAtEdge: f?.fullThrottleAtEdge ?? false,
              apexSpeedKph: f?.apexSpeedKph ?? null,
              throttleM: r.values.throttle,
              brakeResM: f?.brakeAtResM ?? null,
              throttleResM: f?.fullThrottleAtResM ?? null,
            };
          }),
        )
      : null;

  const hlRow = rows.find(r => r.highlighted) ?? null;
  const highlightLine = hlRow
    ? `${hlRow.label}: ${hlRow.cells.time.value} s · brake ${hlRow.cells.brake.value} m · min ${hlRow.cells.minSpeed.value} km/h · full throttle ${hlRow.cells.throttle.value} m`
    : null;

  const lines: ZoomLine[] = rows.flatMap(r => {
    const t = traces.get(r.lapId);
    if (!t) return [];
    const f = lapCornerFacts(byId.get(r.lapId)!, sec);
    return [
      {
        lapId: r.lapId,
        selIndex: r.selIndex,
        highlighted: r.highlighted,
        onIndex: r.onIndex,
        key: r.onIndex != null,
        speedKph: t.speedKph,
        brakePct: t.brakePct,
        throttlePct: t.throttlePct,
        brakeAtM: f?.brakeAtM ?? null,
        fullThrottleAtM: f?.fullThrottleAtM ?? null,
      },
    ];
  });

  const chips = all.map(c => ({n: c.n, label: turnLabel(c.n, c.official)}));

  return {
    corner,
    sectionN: sec.sectionN,
    corners: chips,
    title: `Turn ${turnNumber(corner, sec.official)}`,
    subtitle: [
      formatDistance(sec.apexM),
      `in ${sec.sectionLabel}`,
      `${selected.length} lap${selected.length === 1 ? '' : 's'}`,
      ref ? `compared with L${ref.lapIndex}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    mode,
    explainer: cornerExplainer(sec, nextSec),
    rows,
    strips,
    highlightLine,
    zoom: {
      windowM: [sec.apexM - ZOOM_BEFORE_M, sec.apexM + ZOOM_AFTER_M],
      apexM: sec.apexM,
      lines,
      band:
        band && mode !== 'individual'
          ? {speed: [band.speedKph.p10, band.speedKph.p90]}
          : null,
      stepM: band?.stepM ?? traces.values().next().value?.stepM ?? 5,
    },
    brakeMap: buildBrakeMap(
      rows,
      ref ? traces.get(ref.id) : undefined,
      sec.apexM,
    ),
    prev: chips[(idx - 1 + chips.length) % chips.length]?.n ?? null,
    next: chips[(idx + 1) % chips.length]?.n ?? null,
  };
}

/** Sorted rows for the desktop table. */
export function sortRows(
  rows: CornerRow[],
  by: Measure,
  dir: 'asc' | 'desc',
): CornerRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a.values[by];
    const y = b.values[by];
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * sign;
  });
}

// --- braking map (desktop D3) -------------------------------------------------

// Zoomed track: 350 m before the apex to 200 m after (handoff D3).
export const MAP_BEFORE_M = 350;
export const MAP_AFTER_M = 200;
const MAP_TICKS_M = [-300, -200, -100, 100];

export type BrakeMapPoint = {
  lapId: string;
  selIndex: number;
  isRef: boolean;
  highlighted: boolean;
  onIndex: number | null;
  at: {x: number; y: number};
};

export type BrakeMapModel = {
  /** The reference lap's line through the corner, metres east/north. */
  centreline: {x: number; y: number}[];
  apex: {x: number; y: number};
  ticks: {label: string; at: {x: number; y: number}}[];
  brakes: BrakeMapPoint[];
  throttles: BrakeMapPoint[];
};

/**
 * Where each lap braked and reached full throttle, placed on the reference
 * lap's own line at that distance. Only the reference needs a trace, so this
 * works for every lap, including the ones shown as dots.
 */
export function buildBrakeMap(
  rows: CornerRow[],
  refTrace: GridTrace | undefined,
  apexM: number,
): BrakeMapModel | null {
  if (!refTrace || refTrace.lat.length === 0) return null;
  const from = gridIndex(refTrace, apexM - MAP_BEFORE_M);
  const to = gridIndex(refTrace, apexM + MAP_AFTER_M);
  if (to - from < 2) return null;
  const origin = {lat: refTrace.lat[from], lon: refTrace.lon[from]};
  const at = (m: number) => {
    const i = gridIndex(refTrace, m);
    return toLocalMetres({lat: refTrace.lat[i], lon: refTrace.lon[i]}, origin);
  };
  const centreline = [];
  for (let i = from; i <= to; i++)
    centreline.push(
      toLocalMetres({lat: refTrace.lat[i], lon: refTrace.lon[i]}, origin),
    );
  const inWindow = (m: number) =>
    m >= apexM - MAP_BEFORE_M && m <= apexM + MAP_AFTER_M;
  const points = (distanceOf: (r: CornerRow) => number | null) =>
    rows.flatMap(r => {
      const m = distanceOf(r);
      if (m == null || !inWindow(m)) return [];
      return [
        {
          lapId: r.lapId,
          selIndex: r.selIndex,
          isRef: r.isRef,
          highlighted: r.highlighted,
          onIndex: r.onIndex,
          at: at(m),
        },
      ];
    });
  return {
    centreline,
    apex: at(apexM),
    ticks: MAP_TICKS_M.map(d => ({
      label: `${d > 0 ? '+' : '−'}${Math.abs(d)} m`,
      at: at(apexM + d),
    })),
    brakes: points(r =>
      r.values.brake == null ? null : apexM - r.values.brake,
    ),
    throttles: points(r =>
      r.values.throttle == null ? null : apexM + r.values.throttle,
    ),
  };
}
