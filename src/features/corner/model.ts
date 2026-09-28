import {type GridTrace} from '@/src/analysis/resample';
import {
  type Lap,
  type SessionBand,
  type SessionDetail,
  type TrackMapData,
} from '@/src/data/sessions';
import {formatDistance, formatGap, lapMode, type LapMode} from '@/src/design';

// Corner screen view model (handoff §4, D3). Our corners are grouped into
// sections (S1..Sn), and every lap doc carries facts per section: time from
// the section's entry to the next section's entry, brake point, minimum
// speed and full-throttle point. Pure: data and the URL selection in,
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
  {id: 'time', label: 'Time in section', unit: 's', better: 'lower'},
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
  section: number;
  sections: number[];
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
  if (!allComparable) return selection.laps;
  // With nothing selected, the session's best lap is the reference.
  const ref = selection.laps[0] ?? bestLapId ?? undefined;
  const rest = laps.filter(l => l.comparable && l.id !== ref).map(l => l.id);
  return ref ? [ref, ...rest] : rest;
}

export function buildCornerModel(input: {
  session: SessionDetail;
  laps: Lap[];
  map: TrackMapData;
  band: SessionBand | null;
  traces: Map<string, GridTrace>;
  lapIds: string[];
  hl: string | null;
  section: number;
}): CornerModel | null {
  const {session, laps, map, band, traces, lapIds, section} = input;
  const idx = map.sections.findIndex(s => s.n === section);
  if (idx < 0) return null;
  const sec = map.sections[idx];
  const nextSec = map.sections[(idx + 1) % map.sections.length];
  const byId = new Map(laps.map(l => [l.id, l]));
  const selected = lapIds
    .map(id => byId.get(id))
    .filter((l): l is Lap => l != null);
  const ref = selected[0];
  const mode = lapMode(selected.length);
  const hl =
    input.hl && lapIds.includes(input.hl) ? input.hl : selected[1]?.id ?? null;

  const valuesOf = (l: Lap): Record<Measure, number | null> => {
    const f = l.sections[idx];
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
            unit: m.unit,
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
    ? `${hlRow.label}: ${hlRow.cells.time.value} s · brake ${hlRow.cells.brake.value} m · min ${hlRow.cells.minSpeed.value} km/h · full throttle ${hlRow.cells.throttle.value} m`
    : null;

  const keyIds = new Set([ref?.id, hl].filter(Boolean) as string[]);
  const lines: ZoomLine[] = rows.flatMap(r => {
    const t = traces.get(r.lapId);
    if (!t) return [];
    const f = byId.get(r.lapId)!.sections[idx];
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

  const parts = sec.parts.map(p => p.n);
  const corners =
    parts.length > 1
      ? `C${parts[0]}–C${parts[parts.length - 1]}`
      : parts.length
      ? `C${parts[0]}`
      : null;
  const ns = map.sections.map(s => s.n);

  return {
    section,
    sections: ns,
    title: `Section ${section}`,
    subtitle: [
      formatDistance(sec.apexM),
      corners,
      `${selected.length} lap${selected.length === 1 ? '' : 's'}`,
      ref ? `compared with L${ref.lapIndex}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    mode,
    explainer: `Time in section runs from this section's entry (${formatDistance(
      sec.entryM,
    )}) to the next section's entry (${formatDistance(
      nextSec.entryM,
    )}), the same stretch of track for every lap. Brake point is metres before the apex (${formatDistance(
      sec.apexM,
    )}); full throttle is metres after it.`,
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
