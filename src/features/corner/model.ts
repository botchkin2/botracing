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
  distanceUnit,
  distanceValue,
  formatDistance,
  formatGap,
  lapMode,
  type LapMode,
  METRIC,
  speedUnit,
  speedValue,
  type Units,
} from '@/src/design';

// Corner screen view model (handoff §4, D3), per single corner (C1..Cn).
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
  /** For the gap color and sort: which direction is better. */
  better: 'lower' | 'higher';
}[] = [
  {id: 'time', label: 'Time in corner', better: 'lower'},
  {id: 'brake', label: 'Brake point', better: 'lower'},
  {id: 'minSpeed', label: 'Min speed', better: 'higher'},
  {
    id: 'throttle',
    label: 'Full throttle',
    better: 'lower',
  },
];

export type CornerRow = {
  lapId: string;
  label: string;
  selIndex: number;
  isRef: boolean;
  highlighted: boolean;
  values: Record<Measure, number | null>;
  cells: Record<Measure, {value: string; gap: string | null; better: boolean}>;
};

export type Strip = {
  measure: Measure;
  label: string;
  unit: string;
  summary: string;
  min: number;
  max: number;
  /** Brake point: left means earlier (further before the apex). */
  flipped: boolean;
  dots: {
    lapId: string;
    value: number;
    selIndex: number;
    isRef: boolean;
    highlighted: boolean;
    /** Stack offset for equal values: 0, +1, −1, +2, … (× 5 pt). */
    stack: number;
  }[];
};

export type ZoomLine = {
  lapId: string;
  selIndex: number;
  highlighted: boolean;
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
  /** "km/h" or "mph", for the speed chart label. */
  speedUnit: string;
  /** The section this corner belongs to (Compare opens sections). */
  sectionN: number;
  corners: number[];
  title: string;
  subtitle: string;
  mode: LapMode;
  explainer: string;
  rows: CornerRow[];
  strips: Strip[] | null;
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
const STRIP_MODE_FROM = 20;

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** A measure's stored (metric) value in the display units. */
function displayValue(m: Measure, v: number, units: Units): number {
  if (m === 'minSpeed') return speedValue(v, units);
  if (m === 'brake' || m === 'throttle') return distanceValue(v, units);
  return v;
}

function formatsFor(units: Units): Record<Measure, (v: number) => string> {
  const whole = (m: Measure) => (v: number) =>
    `${Math.round(displayValue(m, v, units))}`;
  return {
    time: v => v.toFixed(3),
    brake: whole('brake'),
    minSpeed: whole('minSpeed'),
    throttle: whole('throttle'),
  };
}

/** A measure's unit label in the display units. */
export function measureUnit(m: Measure, units: Units): string {
  if (m === 'minSpeed') return speedUnit(units);
  if (m === 'brake') return `${distanceUnit(units)} before apex`;
  if (m === 'throttle') return `${distanceUnit(units)} after apex`;
  return 's';
}

/** Laps shown in Corner: the selection, or every comparable lap when asked. */
export function cornerLapIds(
  laps: Lap[],
  selection: CornerSelection,
  allComparable: boolean,
  bestLapId: string | null = null,
): string[] {
  if (!allComparable) return selection.laps;
  // With nothing selected, the session's best lap is the reference.
  const ref = selection.laps[0] ?? bestLapId ?? undefined;
  const rest = laps.filter(l => l.comparable && l.id !== ref).map(l => l.id);
  return ref ? [ref, ...rest] : rest;
}

/**
 * Definition copy. Some stored parts have the apex on the segment edge
 * (entry = apex, or apex = exit); print equal points once, not as if distinct.
 */
export function cornerExplainer(
  sec: {entryM: number; apexM: number; exitM: number},
  nextEntry: {entryM: number},
  units: Units = METRIC,
): string {
  const apex = formatDistance(sec.apexM, units);
  const next = `the next corner's entry (${formatDistance(
    nextEntry.entryM,
    units,
  )})`;
  const span =
    sec.apexM === sec.entryM
      ? `this corner's entry, which is also its apex (${apex}), to ${next}`
      : `this corner's entry (${formatDistance(sec.entryM, units)}) to ${next}`;
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
  hl: string | null;
  corner: number;
  /** Display units; stored data stays metric. */
  units?: Units;
}): CornerModel | null {
  const {session, laps, map, band, traces, lapIds, corner} = input;
  const units = input.units ?? METRIC;
  const fmt = formatsFor(units);
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
                    Math.round(displayValue(m.id, d, units)),
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
      values,
      cells,
    };
  });

  const strips: Strip[] | null =
    selected.length >= STRIP_MODE_FROM
      ? MEASURES.map(m => {
          const vals = rows
            .map(r => r.values[m.id])
            .filter((v): v is number => v != null)
            .sort((a, b) => a - b);
          const seen = new Map<string, number>();
          const dots = rows.flatMap(r => {
            const v = r.values[m.id];
            if (v == null) return [];
            const k = fmt[m.id](v);
            const n = seen.get(k) ?? 0;
            seen.set(k, n + 1);
            return [
              {
                lapId: r.lapId,
                value: v,
                selIndex: r.selIndex,
                isRef: r.isRef,
                highlighted: r.highlighted,
                stack: n === 0 ? 0 : n % 2 ? Math.ceil(n / 2) : -n / 2,
              },
            ];
          });
          return {
            measure: m.id,
            label: m.label,
            unit: measureUnit(m.id, units),
            summary: vals.length
              ? `med ${fmt[m.id](quantile(vals, 0.5))} · p10–90 ${fmt[m.id](
                  quantile(vals, 0.1),
                )}–${fmt[m.id](quantile(vals, 0.9))}`
              : '—',
            min: vals[0] ?? 0,
            max: vals[vals.length - 1] ?? 1,
            flipped: m.id === 'brake',
            dots,
          };
        })
      : null;

  const hlRow = rows.find(r => r.highlighted) ?? null;
  const highlightLine = hlRow
    ? `${hlRow.label}: ${hlRow.cells.time.value} s · brake ${
        hlRow.cells.brake.value
      } ${distanceUnit(units)} · min ${hlRow.cells.minSpeed.value} ${speedUnit(
        units,
      )} · full throttle ${hlRow.cells.throttle.value} ${distanceUnit(units)}`
    : null;

  const keyIds = new Set([ref?.id, hl].filter(Boolean) as string[]);
  const lines: ZoomLine[] = rows.flatMap(r => {
    const t = traces.get(r.lapId);
    if (!t) return [];
    const f = lapCornerFacts(byId.get(r.lapId)!, sec);
    return [
      {
        lapId: r.lapId,
        selIndex: r.selIndex,
        highlighted: r.highlighted,
        key: keyIds.has(r.lapId) || mode === 'individual',
        speedKph: t.speedKph,
        brakePct: t.brakePct,
        throttlePct: t.throttlePct,
        brakeAtM: f?.brakeAtM ?? null,
        fullThrottleAtM: f?.fullThrottleAtM ?? null,
      },
    ];
  });

  const ns = all.map(c => c.n);

  return {
    corner,
    sectionN: sec.sectionN,
    corners: ns,
    title: `Corner ${corner}`,
    subtitle: [
      formatDistance(sec.apexM, units),
      `in ${sec.sectionLabel}`,
      `${selected.length} lap${selected.length === 1 ? '' : 's'}`,
      ref ? `compared with L${ref.lapIndex}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    mode,
    explainer: cornerExplainer(sec, nextSec, units),
    speedUnit: speedUnit(units),
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
    prev: ns[(idx - 1 + ns.length) % ns.length] ?? null,
    next: ns[(idx + 1) % ns.length] ?? null,
  };
}

/** Which laps need traces: all in individual mode, else the key laps only. */
export function traceIdsFor(lapIds: string[], hl: string | null): string[] {
  if (lapIds.length < 7) return lapIds;
  const ids = [lapIds[0], hl ?? lapIds[1]].filter(Boolean) as string[];
  return [...new Set(ids)];
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
