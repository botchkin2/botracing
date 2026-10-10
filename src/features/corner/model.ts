import {toLocalMetres} from '@/src/analysis/geo';
import {medianBasisOf} from '@/src/analysis/medianBasis';
import {
  MAP_AFTER_M,
  MAP_BEFORE_M,
  ZOOM_AFTER_M,
  ZOOM_BEFORE_M,
  zoomWindowFor,
} from '@/src/analysis/cornerWindows';
import {type GridTrace, gridIndex} from '@/src/analysis/resample';
import {turnTitleOf} from '@/src/analysis/turnNames';
import {
  type DefaultSession,
  defaultLapIds,
  type Lap,
  openingLapIds,
  type SessionBand,
  type SessionDetail,
  type TrackCorner,
  type TrackMapData,
  trackCorners,
} from '@/src/data/sessions';
import {formatGap, lapMode, type LapMode, turnLabel} from '@/src/design';

import {deltaFromEntry} from './deltaFromEntry';
import {
  cornerSources,
  sectionMembers,
  entryPartOf,
  wholeLabel,
  wholeTitle,
} from './wholeCorner';
import {
  buildSectionWindow,
  isCurrent,
  type SectionWindowModel,
} from './sectionWindow';
import {brakeZone} from './brakeZone';
import {buildStrips, type StripModel} from './strips';
import {type EdgeRun, edgeRuns} from './trackEdges';
import {
  type CornerStretch,
  cornerView,
  dimmedRanges,
  inWindowFrame,
  type NeighbourApex,
  windowCaption,
} from './stretch';

// Corner screen view model (handoff §4, D3), per single corner (T1..Tn).
// Every lap doc carries facts per corner (sections' parts): time from the
// corner's entry to the next corner's entry, brake point, minimum speed and
// full-throttle point. Pure: data and the URL selection in,
// everything the screen draws out. Colors are left to the screen (selIndex).

export type CornerSelection = {
  /** Lap ids; their order is the colour order, not a reference. */
  laps: string[];
  /** Compare's Ref lap, when one is set. */
  ref?: string | null;
  hl: string | null;
};

export type Measure =
  | 'time'
  | 'brake'
  | 'peakBrake'
  | 'turnIn'
  | 'minSpeed'
  | 'pickup'
  | 'throttle'
  | 'minThrottle';

export const MEASURES: {
  id: Measure;
  label: string;
  unit: string;
  /** For the gap color and sort: which direction is better; null for a value with no good or bad side. */
  better: 'lower' | 'higher' | null;
}[] = [
  {id: 'time', label: 'Time in corner', unit: 's', better: 'lower'},
  {id: 'brake', label: 'Brake point', unit: 'm before apex', better: 'lower'},
  {id: 'peakBrake', label: 'Peak brake %', unit: '%', better: null},
  {id: 'turnIn', label: 'Turn-in', unit: 'm before apex', better: null},
  {id: 'minSpeed', label: 'Min speed', unit: 'km/h', better: 'higher'},
  {id: 'pickup', label: 'Throttle pickup', unit: 'm after apex', better: null},
  {
    id: 'throttle',
    label: 'Full throttle',
    unit: 'm after apex',
    better: 'lower',
  },
  {id: 'minThrottle', label: 'Min throttle %', unit: '%', better: null},
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
  /** The apexes the lap's brake and throttle distances are measured from: the part braked for and the exit part over a whole compound window, else the corner's own. */
  brakeApexM?: number;
  throttleApexM?: number;
};

export type ZoomLine = {
  lapId: string;
  /** A comparable lap: the fitted scales read these only. */
  comparable: boolean;
  /** "L5", as the table shows it. */
  label: string;
  selIndex: number;
  highlighted: boolean;
  onIndex: number | null;
  key: boolean;
  speedKph: number[];
  brakePct: number[];
  /** Gear on the grid: integers, stepped, never interpolated. */
  gear: number[];
  /** The lap's own grid step, metres. */
  stepM: number;
  throttlePct: number[];
  /** Seconds behind the reference, zero at this turn's entry (desktop). */
  deltaS: number[];
  /** Steering, % of lock, on the grid (desktop). */
  steeringPct: number[];
  /** Every channel's recorded samples: what the desktop charts draw and
   *  the readouts take their nearest value from. Lateral and edge are empty
   *  for a trace uploaded before analysis version 9. */
  samples: GridTrace['samples'];
  /** Absolute distances of this lap's brake and full-throttle points. */
  brakeAtM: number | null;
  fullThrottleAtM: number | null;
};

export type CornerModel = {
  corner: number;
  /** The section this corner belongs to (Compare opens sections). */
  sectionN: number;
  /** Every corner, for prev/next: its number and display label. */
  corners: {n: number; label: string}[];
  /** The chips: one per section, and the current compound section's parts to drill into. */
  sections: ReturnType<typeof sectionChips>['sections'];
  parts: ReturnType<typeof sectionChips>['parts'];
  /** The Parts row's "All" option; null for a single corner. */
  all: ReturnType<typeof sectionChips>['all'];
  /** The window spans the whole compound section (first entry to last exit). */
  whole: boolean;
  title: string;
  subtitle: string;
  mode: LapMode;
  rows: CornerRow[];
  strips: StripModel[] | null;
  /** The section's window, split and compared; null until the track has boundaries. */
  window: SectionWindowModel | null;
  zoom: {
    windowM: [number, number];
    apexM: number;
    /** Where the delta is zero, in the window's frame: the stretch's start, or a part's section start. */
    deltaFromM: number;
    lines: ZoomLine[];
    band: {speed: [number[], number[]]} | null;
    stepM: number;
    /** This turn's own stretch, the ranges outside it to dim, the neighbouring
     *  apexes in the window, and the caption that says so (stretch.ts). */
    stretch: CornerStretch;
    /** The track edges seen by the laps in the window, per side (racing-line
     *  chart). Empty without lateral data. */
    edges: {right: EdgeRun[]; left: EdgeRun[]};
    dimmed: [number, number][];
    /** The median braking zone for the brake trace; null when no lap braked here. */
    brakeZone: [number, number] | null;
    neighbours: NeighbourApex[];
    caption: string;
  };
  /** Desktop braking map; null until the reference lap's trace loads. */
  brakeMap: BrakeMapModel | null;
  prev: number | null;
  next: number | null;
};

// The windows live in src/analysis/cornerWindows.ts, where the uploader's
// slice files read them too.
export {ZOOM_AFTER_M, ZOOM_BEFORE_M};
// Strips start where the table's individual lap colours end (lapMode: 7+ laps),
// so a 16-lap race gets them; below that the table shows every lap.
const STRIP_MODE_FROM = 7;

/**
 * A table cell for a lap already at full throttle at the slowest sample: the
 * analyzer's fullThrottleAtEdge. That is a flat turn, but also a lap that
 * lifted before it and was back on the throttle by the minimum, so the
 * wording says what was measured, not "flat".
 */
export const AT_MIN = 'at min';

const fmt: Record<Measure, (v: number) => string> = {
  time: v => v.toFixed(3),
  brake: v => `${Math.round(v)}`,
  peakBrake: v => `${Math.round(v)}`,
  turnIn: v => `${Math.round(v)}`,
  minSpeed: v => `${Math.round(v)}`,
  pickup: v => `${Math.round(v)}`,
  throttle: v => `${Math.round(v)}`,
  minThrottle: v => `${Math.round(v)}`,
};

/**
 * Laps shown in Corner: the selection, or every comparable lap when asked. With
 * nothing selected, the session's opening set (openingLapIds, the same one the
 * session and Compare open on), so the three screens agree.
 */
export function cornerLapIds(
  laps: Lap[],
  selection: CornerSelection,
  allComparable: boolean,
  session: DefaultSession | null = null,
): string[] {
  const bestLapId = session?.bestLapId ?? null;
  if (!allComparable) {
    if (selection.laps.length > 0) return selection.laps;
    return session
      ? openingLapIds(laps, session)
      : defaultLapIds(laps, bestLapId);
  }
  // With nothing selected, the session's best lap is the reference.
  const ref = selection.laps[0] ?? bestLapId ?? undefined;
  const rest = laps.filter(l => l.comparable && l.id !== ref).map(l => l.id);
  return ref ? [ref, ...rest] : rest;
}

/**
 * The corner's own window, in lap metres: its part's, or the section's when
 * the section is one corner. Null until the reference lap is cut at the
 * boundaries the map carries now (a lap cut at older ones, or before windows
 * existed, has windows that do not match the map's).
 */
function ownWindow(
  map: TrackMapData,
  sectionN: number,
  corner: number,
  ref: Lap | undefined,
  whole = false,
): {own: CornerStretch; section: CornerStretch} | null {
  const b = map.boundaries;
  if (!b || !ref || !isCurrent(ref, b)) return null;
  const w = b.windows.find(x => x.kind === 'section' && x.section === sectionN);
  if (!w) return null;
  const at = whole ? w : w.parts.find(p => p.n === corner) ?? w;
  return {
    own: {fromM: at.fromM, toM: at.toM},
    section: {fromM: w.fromM, toM: w.toM},
  };
}

/** One chip per section (a compound one reads "S5 (T8–T10)") and the parts of the current one. */
export function sectionChips(
  all: TrackCorner[],
  current: TrackCorner,
  whole = false,
): {
  sections: {
    sectionN: number;
    label: string;
    firstCorner: number;
    selected: boolean;
  }[];
  parts: {n: number; label: string; selected: boolean}[];
  /** The "All" chip of a compound section: the whole window as one corner. */
  all: {selected: boolean} | null;
} {
  const sections: ReturnType<typeof sectionChips>['sections'] = [];
  for (const c of all) {
    if (sections.some(s => s.sectionN === c.sectionN)) continue;
    const members = all.filter(x => x.sectionN === c.sectionN);
    sections.push({
      sectionN: c.sectionN,
      label: members.length > 1 ? c.sectionLabel : turnLabel(c.n, c.official),
      firstCorner: c.n,
      selected: c.sectionN === current.sectionN,
    });
  }
  const members = all.filter(x => x.sectionN === current.sectionN);
  return {
    sections,
    parts:
      members.length > 1
        ? members.map(m => ({
            n: m.n,
            label: turnLabel(m.n, m.official),
            selected: !whole && m.n === current.n,
          }))
        : [],
    all: members.length > 1 ? {selected: whole} : null,
  };
}

/** The median of the non-null numbers; null when there are none. */
function medianOf(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x != null).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
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
  /** Compare's Ref, as the URL names it: the basis when set; else the median. */
  refId?: string | null;
  corner: number;
  /** Read the whole compound section as one corner ("All" in the Parts row). */
  whole?: boolean;
}): CornerModel | null {
  const {laps, map, band, traces, lapIds, corner} = input;
  const onIndexOf = new Map(input.keyLapIds.map((id, i) => [id, i]));
  const all = trackCorners(map);
  const at = all.findIndex(c => c.n === corner);
  if (at < 0) return null;
  // "All" reads the section's window through its last part: that part's slice
  // file already spans the section's start to the last exit, and its apex is
  // the one the charts are framed on.
  const members = sectionMembers(all, all[at]);
  const whole = input.whole === true && members.length > 1;
  const sec = whole ? members[members.length - 1] : all[at];
  const idx = all.findIndex(c => c.n === sec.n);
  const firstIdx = all.findIndex(c => c.n === (whole ? members[0].n : sec.n));
  const sectionApexM = map.sections[sec.sectionIndex].apexM;
  const byId = new Map(laps.map(l => [l.id, l]));
  const selected = lapIds
    .map(id => byId.get(id))
    .filter((l): l is Lap => l != null);
  // The basis: the Ref lap when one is picked, else the median of the set,
  // column by column (Compare's rule since #445). No lap is the reference.
  const ref =
    input.refId && selected.some(l => l.id === input.refId)
      ? selected.find(l => l.id === input.refId)
      : undefined;
  const mode = lapMode(selected.length);
  const hl =
    input.hl && lapIds.includes(input.hl) ? input.hl : selected[1]?.id ?? null;

  // One entry part for the whole set, so a column never mixes apexes.
  const entryN = whole ? entryPartOf(selected, all, sec) : null;
  const sourcesOf = (l: Lap) =>
    cornerSources(l, all, sec, whole, sectionApexM, entryN);
  const valuesOf = (l: Lap): Record<Measure, number | null> => {
    // Over one corner all three sources are its own; over the whole compound
    // window they differ (wholeCorner.ts says which part each fact is from).
    const {entry, exit, throttle, whole: win} = sourcesOf(l);
    const f = win.facts;
    // The slowest sample sat on the window's edge: the car was still slowing at
    // turn-in or already slower at the exit, so there is no minimum of this
    // corner, and nothing measured from an apex that was not reached (bias,
    // pit wall thread 58 #3751): null, not a number from the boundary. The
    // entry facts are judged by the entry part's own flag; the exit facts by
    // the window's: a last part taken while accelerating still belongs to a
    // window that had a slowest point.
    const e = entry.facts;
    const x = exit.facts;
    const entryEdge = e?.minSpeedAtEdge === true;
    const exitEdge = f?.minSpeedAtEdge === true;
    return {
      time: f?.segTimeS ?? null,
      brake: e?.brakeAtM == null ? null : entry.apexM - e.brakeAtM,
      peakBrake: e?.peakBrakePct ?? null,
      turnIn:
        entryEdge || e?.turnInAtM == null ? null : entry.apexM - e.turnInAtM,
      minSpeed: exitEdge ? null : f?.minSpeedKph ?? null,
      pickup:
        exitEdge || x?.throttlePickupAtM == null
          ? null
          : x.throttlePickupAtM - exit.apexM,
      // Already at full throttle at the slowest sample: no full-throttle point,
      // the search's start is not a point on the lap.
      throttle:
        exitEdge ||
        throttle.facts?.fullThrottleAtM == null ||
        throttle.facts.fullThrottleAtEdge
          ? null
          : throttle.facts.fullThrottleAtM - throttle.apexM,
      // A pedal that never closed has no pickup: how far it came off instead.
      minThrottle:
        exitEdge || x?.throttlePickupAtM != null
          ? null
          : x?.minThrottlePct ?? null,
    };
  };
  const isAtMin = (l: Lap) =>
    sourcesOf(l).throttle.facts?.fullThrottleAtEdge === true;
  // Per column: the Ref's value, or the median of the set's non-null values.
  const allValues = selected.map(valuesOf);
  const refValues = ref ? valuesOf(ref) : null;
  const basis = Object.fromEntries(
    MEASURES.map(m => [
      m.id,
      refValues ? refValues[m.id] : medianOf(allValues.map(v => v[m.id])),
    ]),
  ) as Record<Measure, number | null>;

  const rows: CornerRow[] = selected.map((l, i) => {
    const values = valuesOf(l);
    const cells = Object.fromEntries(
      MEASURES.map(m => {
        const v = values[m.id];
        const r = basis[m.id];
        const d = v != null && r != null && l.id !== ref?.id ? v - r : null;
        return [
          m.id,
          {
            value:
              v != null
                ? fmt[m.id](v)
                : m.id === 'throttle' && isAtMin(l)
                ? AT_MIN
                : '—',
            gap:
              d == null
                ? null
                : m.id === 'time'
                ? formatGap(d)
                : `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(
                    Math.round(d),
                  )}`,
            better:
              d != null &&
              m.better != null &&
              (m.better === 'lower' ? d < 0 : d > 0),
          },
        ];
      }),
    ) as CornerRow['cells'];
    return {
      lapId: l.id,
      label: `L${l.lapIndex}`,
      selIndex: i,
      isRef: l.id === ref?.id,
      highlighted: l.id === hl,
      onIndex: onIndexOf.get(l.id) ?? null,
      values,
      cells,
      brakeApexM: sourcesOf(l).entry.apexM,
      throttleApexM: sourcesOf(l).throttle.apexM,
    };
  });

  const strips: StripModel[] | null =
    selected.length >= STRIP_MODE_FROM
      ? buildStrips(
          rows.map(r => {
            const src = sourcesOf(byId.get(r.lapId) as Lap);
            const f = src.whole.facts;
            return {
              lapId: r.lapId,
              label: r.label,
              onIndex: r.onIndex,
              timeS: r.values.time,
              brakeM: r.values.brake,
              minSpeedKph: f?.minSpeedKph ?? null,
              minSpeedAtEdge: f?.minSpeedAtEdge ?? false,
              throttleAtEdge: src.throttle.facts?.fullThrottleAtEdge ?? false,
              apexSpeedKph: f?.apexSpeedKph ?? null,
              throttleM: r.values.throttle,
              brakeResM: src.entry.facts?.brakeAtResM ?? null,
              throttleResM: src.throttle.facts?.fullThrottleAtResM ?? null,
            };
          }),
        )
      : null;

  // The corner's own window (a part's, or the section's when it is one corner)
  // is shaded and the charts run to its edges, once the laps are cut at the
  // boundaries the map carries; otherwise the old entry-to-next-entry stretch.
  // Under the median basis there is no Ref lap; any shown lap cut at the
  // current boundaries says the window exists.
  const windows = ownWindow(
    map,
    sec.sectionN,
    corner,
    ref ?? selected.find(l => map.boundaries && isCurrent(l, map.boundaries)),
    whole,
  );
  const own = windows?.own ?? null;
  const baseWindow: [number, number] = [
    sec.apexM - ZOOM_BEFORE_M,
    sec.apexM + ZOOM_AFTER_M,
  ];
  const ownFrame = own ? inWindowFrame(own, baseWindow, map.lengthM) : null;
  // The charts run from the section's start (where the delta is drawn from) to
  // the corner's own end: the same extent the slice is cut to, so what the
  // charts ask for is always in the file (tools/sessions/cornerSlices.mjs).
  const zoomExtent =
    windows && own
      ? inWindowFrame(
          {fromM: windows.section.fromM, toM: own.toM},
          baseWindow,
          map.lengthM,
        )
      : null;
  const zoomWindow = zoomWindowFor(sec.apexM, zoomExtent);
  const baseView = cornerView(all, idx, zoomWindow, map.lengthM);
  if (!baseView) return null;
  // The delta is drawn from where laps share speed: a section's start, which
  // for a part is earlier than the part's own (mid-chicane, laps already
  // differ). It cannot start before the drawn stretch.
  const isPart = windows != null && windows.section.fromM !== own?.fromM;
  const sectionFrame = windows
    ? inWindowFrame(windows.section, baseWindow, map.lengthM)
    : null;
  const anchorM = sectionFrame
    ? Math.max(sectionFrame.fromM, zoomWindow[0])
    : baseView.stretch.fromM;
  const view =
    own && ownFrame
      ? {
          ...baseView,
          stretch: ownFrame,
          caption: windowCaption(
            whole
              ? wholeLabel(sec.sectionLabel)
              : turnLabel(sec.n, sec.official),
            own,
            ownFrame,
            whole
              ? baseView.neighbours.filter(n => !members.some(m => m.n === n.n))
              : baseView.neighbours,
            zoomWindow,
            windows && isPart
              ? {
                  label: `S${sec.sectionN}`,
                  lapM: windows.section.fromM,
                  drawn:
                    sectionFrame != null && sectionFrame.fromM >= zoomWindow[0],
                }
              : null,
          ),
        }
      : baseView;
  // Over the whole compound window the map spans first entry to last exit, so
  // the first part's brake point is on it.
  const mapWindow: [number, number] = [
    sec.apexM - MAP_BEFORE_M,
    sec.apexM + MAP_AFTER_M,
  ];
  if (whole && sectionFrame) {
    mapWindow[0] = Math.min(mapWindow[0], sectionFrame.fromM);
    mapWindow[1] = Math.max(mapWindow[1], sectionFrame.toM);
  }
  const mapView = cornerView(all, idx, mapWindow, map.lengthM);

  // The median basis trace is the one Compare builds (medianBasisOf).
  const refTrace = ref ? traces.get(ref.id) : medianBasisOf(selected, traces);
  const lines: ZoomLine[] = rows.flatMap(r => {
    const t = traces.get(r.lapId);
    if (!t) return [];
    const src = sourcesOf(byId.get(r.lapId)!);
    return [
      {
        lapId: r.lapId,
        comparable: byId.get(r.lapId)?.comparable === true,
        label: r.label,
        selIndex: r.selIndex,
        highlighted: r.highlighted,
        onIndex: r.onIndex,
        key: r.onIndex != null,
        speedKph: t.speedKph,
        brakePct: t.brakePct,
        gear: t.gear,
        stepM: t.stepM,
        throttlePct: t.throttlePct,
        // Zero at the turn's entry; the stretch is in the window's frame.
        deltaS: deltaFromEntry(t, refTrace, anchorM),
        steeringPct: t.steeringPct,
        samples: t.samples,
        brakeAtM: src.entry.facts?.brakeAtM ?? null,
        fullThrottleAtM: src.throttle.facts?.fullThrottleAtEdge
          ? null
          : src.throttle.facts?.fullThrottleAtM ?? null,
      },
    ];
  });

  const chips = all.map(c => ({n: c.n, label: turnLabel(c.n, c.official)}));
  const {sections, parts, all: allChip} = sectionChips(all, sec, whole);
  return {
    corner,
    sectionN: sec.sectionN,
    corners: chips,
    sections,
    parts,
    all: allChip,
    whole,
    title: whole
      ? wholeTitle(sec.sectionLabel)
      : turnTitleOf(turnLabel(corner, sec.official)),
    subtitle: [
      `in ${sec.sectionLabel}`,
      `${selected.length} lap${selected.length === 1 ? '' : 's'}`,
      // The basis, named the way Compare names it: a Ref lap, else the median.
      ref ? `vs L${ref.lapIndex}` : `vs median of ${selected.length}`,
    ]
      .filter(Boolean)
      .join(' · '),
    mode,
    rows,
    strips,
    window: buildSectionWindow({
      map,
      sectionN: sec.sectionN,
      laps: selected,
      sessionLaps: laps,
      refId: input.refId ?? null,
    }),
    zoom: {
      windowM: zoomWindow,
      apexM: sec.apexM,
      deltaFromM: anchorM,
      lines,
      band:
        band && mode !== 'individual'
          ? {speed: [band.speedKph.p10, band.speedKph.p90]}
          : null,
      stepM: band?.stepM ?? traces.values().next().value?.stepM ?? 5,
      stretch: view.stretch,
      edges: edgeRuns(
        lines.map(l => l.samples.trackEdgeM),
        zoomWindow[0],
        zoomWindow[1],
      ),
      dimmed: dimmedRanges(zoomWindow, view.stretch),
      brakeZone: brakeZone(lines, view.stretch.toM),
      neighbours: view.neighbours,
      caption: view.caption,
    },
    brakeMap: buildBrakeMap(rows, refTrace, sec.apexM, mapView, mapWindow),
    prev: chips[(firstIdx - 1 + chips.length) % chips.length]?.n ?? null,
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

export {MAP_AFTER_M, MAP_BEFORE_M};
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
  /** The part of the line that is this turn's own stretch: first and last
   *  point index into `centreline`. Null when no stretch falls in the map. */
  stretch: [number, number] | null;
  /** Neighbouring apexes on the map, named. */
  neighbours: {label: string; at: {x: number; y: number}}[];
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
  view: {stretch: CornerStretch; neighbours: NeighbourApex[]} | null = null,
  /** The metres the map shows; the apex's usual window unless widened. */
  windowM: [number, number] = [apexM - MAP_BEFORE_M, apexM + MAP_AFTER_M],
): BrakeMapModel | null {
  if (!refTrace || refTrace.lat.length === 0) return null;
  const from = gridIndex(refTrace, windowM[0]);
  const to = gridIndex(refTrace, windowM[1]);
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
  const inWindow = (m: number) => m >= windowM[0] && m <= windowM[1];
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
  // The stretch as indices into the centreline (one point per grid step).
  let stretch: [number, number] | null = null;
  if (view) {
    const a = Math.max(from, gridIndex(refTrace, view.stretch.fromM));
    const b = Math.min(to, gridIndex(refTrace, view.stretch.toM));
    if (b > a) stretch = [a - from, b - from];
  }
  return {
    centreline,
    stretch,
    neighbours: (view?.neighbours ?? []).map(n => ({
      label: `${n.label} apex`,
      at: at(n.apexM),
    })),
    apex: at(apexM),
    ticks: MAP_TICKS_M.map(d => ({
      label: `${d > 0 ? '+' : '−'}${Math.abs(d)} m`,
      at: at(apexM + d),
    })),
    brakes: points(r =>
      r.values.brake == null ? null : (r.brakeApexM ?? apexM) - r.values.brake,
    ),
    throttles: points(r =>
      r.values.throttle == null
        ? null
        : (r.throttleApexM ?? apexM) + r.values.throttle,
    ),
  };
}
