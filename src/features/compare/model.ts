import {nearestSample, type NativeSamples} from '@/src/analysis/nativeSamples';
import {type TrackSurface} from '@/src/analysis/trackSurface';
import {type LaneRow, laneRowOf} from '@/src/analysis/trafficLane';
import {
  type GridTrace,
  gridIndex,
  type NativeChannel,
  timeDiffS,
} from '@/src/analysis/resample';
import {sectionFitRange} from '@/src/analysis/sectionFit';
import {type WindowMode, windowRange, windowTimeS} from '@/src/analysis/window';
import {CHANNEL_IDS, type ChannelId, PRESETS} from '@/src/state/comparePrefs';
import {
  defaultLapIds,
  firstCornerOf,
  type Lap,
  type SessionBand,
  type DefaultSession,
  type SessionDetail,
  type MapSection,
  mapPlacer,
  measuredCentreLines,
  type TrackMapData,
  referenceDefaultLapIds,
  trackCorners,
} from '@/src/data/sessions';
import {
  formatDistance,
  formatGap,
  formatLapTime,
  lapMode,
  type LapMode,
  turnLabel,
} from '@/src/design';
import {buildTrackMarks, type TrackMarks} from '@/src/charts';

import {
  buildFollowView,
  type FollowGeometry,
  type FollowView,
} from './followModel';
import {
  headAfter,
  lapNeighbours,
  type Neighbours,
  type Side,
  tailBefore,
  WRAP_M,
} from './neighbours';

// Compare screen view model (handoff §3). Pure: session data, resampled
// traces and the URL selection in; everything the screen draws out. Colors
// are left to the screen: each lap carries `selIndex` (0 = reference) and
// whether it is a key lap (drawn in full color, with values shown).

export type CompareSelection = {
  /** Lap ids in selection order; the first is the reference. */
  laps: string[];
  /** The highlighted lap (tapped chip or value); defaults to the second lap. */
  hl: string | null;
  /** Open corner number, if any. */
  corner: number | null;
  /** Cursor distance from the line, metres. */
  cursorM: number;
};

/** Chart window: seconds (time) or metres (distance); size null = whole lap. */
export type ChartWindow = {mode: WindowMode; size: number | null};
export type ChartTimeAxis = {ref: GridTrace; windowS: [number, number]} | null;

export type {ChannelId} from '@/src/state/comparePrefs';

type ChannelSpec = {
  label: string;
  unit: string;
  explainer: string;
  /** Shared scale for channels of the same kind. */
  kind: 'time' | 'speed' | 'pedal' | 'steer' | 'gear';
  /** In a window, the y range snaps outward to this step (see domainOf). */
  ySnap?: number;
  height: number;
  /** Desktop workspace height (handoff D2). */
  desktopHeight: number;
  format: (v: number) => string;
  pick: (t: GridTrace) => number[];
  /** Drawn from, and read at, its recorded samples (not the grid). */
  native?: NativeChannel;
};

// Heights and copy from the handoff (Compare chart heights, chart descs).
export const CHANNELS: Record<ChannelId, ChannelSpec> = {
  timeDiff: {
    label: 'Time diff',
    unit: 's',
    explainer:
      'Running gap to the reference. Line rising = losing time there, falling = gaining.',
    kind: 'time',
    height: 62,
    desktopHeight: 96,
    format: v => formatGap(v),
    pick: t => t.timeS,
  },
  speed: {
    label: 'Speed',
    unit: 'km/h',
    explainer:
      'Grey band = where your race laps usually are (10th–90th percentile).',
    kind: 'speed',
    ySnap: 20,
    height: 104,
    desktopHeight: 150,
    format: v => v.toFixed(0),
    pick: t => t.speedKph,
    native: 'speedKph',
  },
  throttle: {
    label: 'Throttle',
    unit: '%',
    explainer: 'Throttle pedal, 0–100%.',
    kind: 'pedal',
    height: 50,
    desktopHeight: 106,
    format: v => v.toFixed(0),
    pick: t => t.throttlePct,
    native: 'throttlePct',
  },
  brake: {
    label: 'Brake',
    unit: '%',
    explainer: 'Brake pedal, 0–100%. Where it starts is the brake point.',
    kind: 'pedal',
    height: 50,
    desktopHeight: 106,
    format: v => v.toFixed(0),
    pick: t => t.brakePct,
    native: 'brakePct',
  },
  steering: {
    label: 'Steering',
    // LMU records steering as % of lock, not degrees (docs/LMU_SYNC_NOTES.md).
    unit: '% lock',
    explainer: 'Steering, as % of full lock. Extra wiggles are corrections.',
    kind: 'steer',
    ySnap: 10,
    height: 56,
    desktopHeight: 84,
    format: v => v.toFixed(0),
    pick: t => t.steeringPct,
    native: 'steeringPct',
  },
  gear: {
    label: 'Gear',
    unit: '',
    explainer: 'Gear selected.',
    kind: 'gear',
    height: 44,
    desktopHeight: 60,
    format: v => v.toFixed(0),
    pick: t => t.gear,
    native: 'gear',
  },
};

/** Default chart set: [Time diff] [Speed] [Pedals] [Gear]. */
export const DEFAULT_CHARTS: ChannelId[][] = PRESETS[0].charts;

/**
 * The pedals chart (round 3 R4a): throttle line and brake fill share the top
 * of the plot, steering sits in its own band under them, all on one time axis.
 * Heights are the handoff's 96 (pedals) + 8 (gap) + 36 (steering) of 140.
 */
export const PEDALS_CHART: ChannelId[] = ['throttle', 'brake', 'steering'];
const PEDALS_H = 140;
const PEDALS_TOP_FRAC = 96 / PEDALS_H;
const STEER_BAND_FRAC = 36 / PEDALS_H;

export function isPedalsChart(chs: ChannelId[]): boolean {
  return (
    chs.length === PEDALS_CHART.length &&
    PEDALS_CHART.every(c => chs.includes(c))
  );
}

/**
 * y domains that place both kinds in one plot: pedals (fixed −4..104) in the
 * top fraction, steering (±m, symmetric) in the bottom band, so the zero
 * line of the band is its own. A value's y is linear in its domain, so a
 * domain wider than the data leaves the rest of the plot empty for the other.
 */
export function pedalsDomains(steerM: number): {
  pedal: [number, number];
  steer: [number, number];
} {
  const pedalSpan = 108 / PEDALS_TOP_FRAC;
  const g = STEER_BAND_FRAC;
  return {
    pedal: [104 - pedalSpan, 104],
    steer: [-steerM, (steerM * (2 - g)) / g],
  };
}

export type LapRef = {
  lapId: string;
  label: string;
  selIndex: number;
  /** Reference or highlighted: full color, values shown, dot on the map. */
  key: boolean;
  highlighted: boolean;
};

export type Chip = LapRef & {delta: string; faster: boolean; isRef: boolean};

export type ChartLine = LapRef & {
  channel: ChannelId;
  /** 0 = solid, 1 = dashed, 2 = dotted (overlay order). */
  overlay: number;
  /** On the grid: y fits and cross-lap maths. */
  values: number[];
  /** Recorded samples, drawn instead of the grid when present. */
  samples?: NativeSamples;
  /** The contiguous previous lap's last metres, before the line (m < 0),
   *  and the next lap's first metres, after the end: drawn dimmed. */
  before?: NativeSamples;
  after?: NativeSamples;
};

export type ChartValueRow = {
  channel: ChannelId;
  label: string;
  unit: string;
  overlay: number;
  values: {
    lapId: string;
    selIndex: number;
    highlighted: boolean;
    text: string;
  }[];
};

export type ChartModel = {
  key: string;
  channels: ChannelId[];
  title: string;
  explainer: string;
  height: number;
  desktopHeight: number;
  lines: ChartLine[];
  /** Per-channel y domains, keyed by channel. */
  domains: Partial<Record<ChannelId, [number, number]>>;
  band: {low: number[]; high: number[]} | null;
  /** The channel whose 0 gets a line (time diff, else steering), if any. */
  zeroLine: ChannelId | null;
  /** Throttle, brake and steering drawn together (see PEDALS_CHART). */
  pedals: boolean;
  valueRows: ChartValueRow[];
};

export type CornerGridModel = {
  explainer: string;
  corners: number[];
  rows: {
    key: string;
    label: string;
    lapId: string | null;
    selIndex: number | null;
    cells: (number | null)[];
  }[];
};

export type MapModel = {
  /**
   * The measured road is still on its way (a hit, none, or a failure all end
   * the wait): the panel holds its place instead of drawing OSM and then
   * reshaping the road under the cursor.
   */
  roadPending: boolean;
  /** Drawn on the OSM outline (fit good), or on the driven line. */
  realMap: boolean;
  /** Outline stretches the reference lap runs along, and the rest (drawn quietly). */
  outline: {x: number; y: number}[][];
  outlineFaded: {x: number; y: number}[][];
  pitLane: {x: number; y: number}[][];
  marks: TrackMarks;
  lines: (LapRef & {points: {x: number; y: number}[]})[];
  dots: (LapRef & {at: {x: number; y: number}})[];
  /** Follow's position label, e.g. "Section 4 · T8 apex". */
  followPlace: string;
  /** Each section's apex distance, for the strip. */
  sectionApexes: {n: number; apexM: number}[];
  attribution: string | null;
  /** Null until the geometry is built (the hook memoizes it). */
  follow: (FollowView & {geometry: FollowGeometry}) | null;
};

/**
 * One row per selected lap that has traffic positions, in chip order, or the
 * empty state for a session with no field. A session with a field whose laps
 * are not yet analysed for positions has no lane: an empty lane there would
 * read as "no traffic".
 */
export type TrafficLaneModel =
  | {kind: 'empty'}
  | {
      kind: 'rows';
      rows: (LaneRow & {
        lapId: string;
        selIndex: number;
        highlighted: boolean;
        label: string;
      })[];
    };

export function trafficLaneOf(
  session: SessionDetail,
  refs: LapRef[],
  byId: Map<string, Lap>,
  lengthM: number,
): TrafficLaneModel | null {
  if (refs.length === 0) return null;
  if (session.field == null) return {kind: 'empty'};
  const rows = refs.flatMap(r => {
    const lane = laneRowOf(byId.get(r.lapId)?.traffic ?? null, lengthM);
    return lane
      ? [
          {
            ...lane,
            lapId: r.lapId,
            selIndex: r.selIndex,
            highlighted: r.highlighted,
            label: r.label,
          },
        ]
      : [];
  });
  return rows.length > 0 ? {kind: 'rows', rows} : null;
}

export type CompareModel = {
  mode: LapMode;
  /** The lap whose moment the field radar shows: the highlighted lap, else the reference. */
  playing: {lapId: string; lapNumber: number | null} | null;
  reference: string;
  chips: Chip[];
  manyChip: string | null;
  map: MapModel | null;
  position: {
    place: string;
    distance: string;
  };
  grid: CornerGridModel | null;
  charts: ChartModel[];
  /** The car-ahead lane under the last chart; null when there is nothing true to draw (round 7, 2C). */
  trafficLane: TrafficLaneModel | null;
  stepM: number;
  lengthM: number;
  /** Visible distance range of the charts, metres. */
  windowM: [number, number];
  /** Time mode in a window: the charts' x axis is the reference's time. */
  timeAxis: ChartTimeAxis;
  /** The reference lap on the grid: time and distance for pan and playback. */
  refGrid: GridTrace | null;
  /** Corner apex lines inside the window, e.g. "T6 apex", and "S/F" when
   *  the window runs past the line. */
  apexMarks: {m: number; label: string; solid?: boolean}[];
  /** Laps still loading their traces. */
  pending: number;
  /** Lap ids in the URL that this session doesn't have. */
  notFound: number;
  /** Every lap in the session by stint, for picking laps (desktop). */
  allLaps: AllLapsStint[];
  /** Absolute channels of the key laps, for reading values anywhere. */
  readouts: Readout[];
  /** Time diff over the whole lap, for the desktop overview. */
  overview: ChartLine[];
  /** Section number → entry distance, for grid row labels. */
  sectionEntryM: Record<number, number>;
  /** Section number → its first single corner, which Corner opens. */
  sectionFirstCorner: Record<number, number>;
};

export type AllLapsStint = {
  key: string;
  label: string;
  rows: {
    lapId: string;
    label: string;
    time: string;
    gap: string | null;
    gapFaster: boolean;
    comparable: boolean;
    tag: string | null;
    selIndex: number | null;
  }[];
};

export type Readout = {
  lapId: string;
  selIndex: number;
  highlighted: boolean;
  channels: Record<ChannelId, number[]>;
  /** Recorded samples per native channel: readouts use the nearest one. */
  samples: Partial<Record<ChannelId, NativeSamples>>;
};

// A cursor readout carries its unit where the channel has none beside it: the
// time diff's "−0.412" is seconds ("−0.412 s"), and its label names the
// reference (slick #936.3, camber #937).
function readoutText(ch: ChannelId, v: number): string {
  return ch === 'timeDiff'
    ? `${CHANNELS[ch].format(v)} ${CHANNELS[ch].unit}`
    : CHANNELS[ch].format(v);
}

/** Values table rows (desktop): each channel × each key lap at a distance. */
export function valuesAt(
  readouts: Readout[],
  stepM: number,
  m: number,
): {
  channel: ChannelId;
  label: string;
  unit: string;
  values: {
    lapId: string;
    selIndex: number;
    highlighted: boolean;
    text: string;
  }[];
}[] {
  const i = Math.max(0, Math.round(m / stepM));
  return CHANNEL_IDS.map(ch => ({
    channel: ch,
    label: CHANNELS[ch].label,
    unit: CHANNELS[ch].unit,
    values: readouts.map(r => {
      const a = r.channels[ch];
      const own = r.samples[ch];
      const v = own
        ? nearestSample(own, m)
        : a.length
        ? a[Math.min(a.length - 1, i)]
        : null;
      return {
        lapId: r.lapId,
        selIndex: r.selIndex,
        highlighted: r.highlighted,
        text: v == null ? '—' : readoutText(ch, v),
      };
    }),
  }));
}

/**
 * Laps of other sessions in the selection (a reference from an earlier race,
 * pit-wall thread 44 E3). Each has its selection id (`foreignLapId`) as `id`,
 * and a tag for the session it is from ("25 Sep"). They sit beside this
 * session's laps in the charts; nothing that belongs to this session (the
 * field radar, the neighbour laps across the line, the All laps list) reads
 * them.
 */
export type ForeignLaps = {laps: Lap[]; tags: Map<string, string>};

export type CompareInputs = {
  session: SessionDetail;
  /** This session's laps. */
  laps: Lap[];
  foreign?: ForeignLaps;
  /** Resampled traces by lap id; missing while loading. */
  traces: Map<string, GridTrace>;
  band: SessionBand | null;
  map: TrackMapData | null;
  /** The track's measured road, when it has one. */
  surface?: TrackSurface | null;
  /** The surface request has not settled: the road is held back (see MapModel.roadPending). */
  surfacePending?: boolean;
  selection: CompareSelection;
  charts?: ChannelId[][];
  window?: ChartWindow;
  /** Follow geometry for this selection, built once per selection. */
  followGeometry?: FollowGeometry | null;
};

// Map lines are drawn every 20 m: plenty at phone size, a fifth of the points.
const MAP_STRIDE = 4;
const CORNER_NEAR_M = 180;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// The start/finish line, solid and labelled, when the window runs past it
// (the blank lead-in before the lap, or past its end).
function lineMarks(
  ref: GridTrace,
  cursorM: number,
  win: ChartWindow,
  lengthM: number,
  sides: Neighbours | null,
): {m: number; label: string; solid: boolean}[] {
  // An empty side says why: "S/F · pit", "S/F · start".
  const label = (side: Side | undefined) =>
    side?.kind === 'none' ? `S/F · ${side.label}` : 'S/F';
  if (win.size == null) return [];
  const [before, after] =
    win.mode === 'distance'
      ? [cursorM - win.size / 2 < 0, cursorM + win.size / 2 > lengthM]
      : windowTimeS(ref, cursorM, win.size).map((t, i) =>
          i ? t > ref.timeS[ref.timeS.length - 1] : t < 0,
        );
  const out = [];
  if (before) out.push({m: 0, label: label(sides?.before), solid: true});
  if (after) out.push({m: lengthM, label: label(sides?.after), solid: true});
  return out;
}

// The time diff's y range in a window snaps out to 0.05 s and is at least
// 0.1 s tall, so a flat gap does not fill the chart (thread 26 #380).
const TIME_SNAP_S = 0.05;
const TIME_MIN_SPAN_S = 0.1;

// [lo, hi] widened outward to multiples of step.
export function snapOut(
  lo: number,
  hi: number,
  step: number,
): [number, number] {
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  return [a, b > a ? b : a + step];
}

// y range per channel kind. In a window it fits the whole sections the window
// touches (sectionFitRange), snapped, so it changes only when the window
// crosses a section boundary, never mid-corner: the time diff to 0.05 s,
// other channels to their ySnap. Gear fits
// the whole lap; pedals are fixed. Pure: the same window gives the same range.
function domainOf(
  arrays: number[][],
  kind: ChannelSpec['kind'],
  from: number,
  to: number,
  windowed: boolean,
  snap?: number,
): [number, number] {
  // Pedals are fixed at −4..104 so 0 and 100 never sit on the edge.
  if (kind === 'pedal') return [-4, 104];
  const fitWindow = windowed && kind !== 'gear';
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of arrays)
    for (
      let i = fitWindow ? Math.max(0, from) : 0;
      i <= Math.min(a.length - 1, fitWindow ? to : Infinity);
      i++
    ) {
      const v = a[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  if (!Number.isFinite(lo)) return [0, 1];
  if (kind === 'time') {
    // Whole lap: symmetric around 0; the floor keeps a flat line from
    // filling the chart.
    if (!windowed) {
      const m = Math.max(Math.abs(lo), Math.abs(hi), 0.1);
      return [-m, m];
    }
    // In a window: the absolute gap, fitted and snapped, not forced
    // symmetric. The reference sits at 0, so 0 is always inside.
    const [a, b] = snapOut(lo, hi, TIME_SNAP_S);
    const grow = Math.max(0, TIME_MIN_SPAN_S - (b - a)) / 2;
    return [a - grow, b + grow];
  }
  if (kind === 'steer') {
    const m = Math.max(Math.abs(lo), Math.abs(hi), 5);
    return windowed && snap ? snapOut(-m, m, snap) : [-m, m];
  }
  if (kind === 'gear') return [Math.min(lo, 1) - 0.5, hi + 0.5];
  if (windowed && snap) return snapOut(lo, hi, snap);
  const pad = (hi - lo) * 0.05 || 1;
  return [lo - pad, hi + pad];
}

export function cornerPlace(
  sections: {n: number; entryM: number; exitM: number}[],
  cursorM: number,
): string {
  const inside = sections.find(s => cursorM >= s.entryM && cursorM <= s.exitM);
  if (inside) return `Section ${inside.n}`;
  const near = sections.find(
    s => cursorM < s.entryM && s.entryM - cursorM <= CORNER_NEAR_M,
  );
  if (near) return `Section ${near.n}`;
  const before = [...sections].reverse().find(s => s.exitM < cursorM);
  const prev = before ?? sections[sections.length - 1];
  return prev ? `After Section ${prev.n}` : '';
}

/**
 * Follow's position label (handoff v2 M1): the section, plus the corner when
 * the cursor is inside a corner's entry–exit range, e.g. "Section 4 · T8 apex".
 */
export function followPlace(sections: MapSection[], cursorM: number): string {
  const place = cornerPlace(sections, cursorM);
  for (const s of sections)
    for (const c of s.parts.length > 0 ? s.parts : [s])
      if (cursorM >= c.entryM && cursorM <= c.exitM)
        return `${place} · ${turnLabel(c.n, c.official)} apex`;
  return place;
}

// The wrap's neighbour arrays depend only on the traces, which keep their
// identity for a selection (React Query caches each lap's trace), so they are
// built once per trace, not once per playback frame (freeze #628).
const tailCache = new WeakMap<object, NativeSamples>();
const headCache = new WeakMap<object, NativeSamples>();
const diffCache = new WeakMap<object, WeakMap<object, number[]>>();

function cached<T>(cache: WeakMap<object, T>, key: object, build: () => T): T {
  let v = cache.get(key);
  if (v === undefined) {
    v = build();
    cache.set(key, v);
  }
  return v;
}

function cachedDiff(lap: GridTrace, ref: GridTrace): number[] {
  const byRef = cached(diffCache, lap, () => new WeakMap<object, number[]>());
  return cached(byRef, ref, () => timeDiffS(lap, ref));
}

// Each lap's own time diff, and its wrap, are kept the same way: the charts
// cache their lines by array identity (charts/chunkPaths.ts), so a new array
// every frame would rebuild them every frame. A lap's official time is
// fixed by its trace, so the pair of traces is the whole key.
const ownDiffCache = new WeakMap<object, WeakMap<object, number[]>>();
const wrapCache = {
  before: new WeakMap<object, NativeSamples>(),
  after: new WeakMap<object, NativeSamples>(),
};

export function buildCompareModel(input: CompareInputs): CompareModel {
  const {session, laps, traces, band, map, selection} = input;
  const foreignTags = input.foreign?.tags ?? new Map<string, string>();
  const byId = new Map(
    [...laps, ...(input.foreign?.laps ?? [])].map(l => [l.id, l]),
  );
  // "L12", and "L12 · 25 Sep" for a lap of another session: two sessions both
  // have an L12.
  const nameOf = (l: Lap) =>
    foreignTags.has(l.id)
      ? `L${l.lapIndex} · ${foreignTags.get(l.id)}`
      : `L${l.lapIndex}`;
  const selected = selection.laps
    .map(id => byId.get(id))
    .filter((l): l is Lap => l != null);
  const count = selected.length;
  const mode = lapMode(count);
  const ref = selected[0];
  const hlId =
    selection.hl && selection.laps.includes(selection.hl)
      ? selection.hl
      : selected[1]?.id ?? null;

  const playing = selected.find(l => l.id === hlId) ?? ref ?? null;
  // The time diff's label names the lap it is measured against.
  const labelOf = (ch: ChannelId) =>
    ch === 'timeDiff' && ref
      ? `${CHANNELS[ch].label} vs ${nameOf(ref)}`
      : CHANNELS[ch].label;

  const lapRefs: LapRef[] = selected.map((l, i) => ({
    lapId: l.id,
    label: nameOf(l),
    selIndex: i,
    highlighted: l.id === hlId,
    key: i === 0 || l.id === hlId || mode === 'individual',
  }));
  const keyRefs = lapRefs.filter(r => r.key);

  const refTrace = ref ? traces.get(ref.id) : undefined;
  const stepM = refTrace?.stepM ?? band?.stepM ?? 5;
  const lengthM =
    map?.lengthM || band?.lengthM || (refTrace?.distanceM.at(-1) ?? 0);
  const cursorM = Math.max(0, Math.min(lengthM, selection.cursorM));
  const win = input.window ?? {mode: 'time', size: null};
  const windowed = win.size != null && refTrace != null;
  const windowM: [number, number] = refTrace
    ? windowRange(refTrace, cursorM, win.mode, win.size)
    : [0, lengthM];
  const i0 = Math.max(0, Math.floor(windowM[0] / stepM));
  const i1 = Math.ceil(windowM[1] / stepM);
  // y scales fit the whole sections the window touches (thread 26 #381).
  const fitM = sectionFitRange(
    (map?.sections ?? []).map(s => s.entryM),
    lengthM,
    windowM,
  );
  const fitI0 = Math.max(0, Math.floor(fitM[0] / stepM));
  const fitI1 = Math.ceil(fitM[1] / stepM);

  // --- reference line and chips ---------------------------------------------
  const refBits = ref
    ? [
        nameOf(ref),
        ref.timeS == null ? '—' : formatLapTime(ref.timeS),
        ref.id === session.bestLapId
          ? `${session.sessionType === 'R' ? 'Race' : 'Session'} best`
          : null,
      ]
    : [];
  const chips: Chip[] = lapRefs
    .filter(r => mode === 'individual' || r.key)
    .map(r => {
      const lap = byId.get(r.lapId)!;
      const d =
        lap.timeS != null && ref?.timeS != null ? lap.timeS - ref.timeS : null;
      return {
        ...r,
        isRef: r.selIndex === 0,
        delta: r.selIndex === 0 ? 'REF' : d == null ? '—' : formatGap(d),
        faster: d != null && d < 0,
      };
    });
  const manyChip =
    mode === 'individual'
      ? null
      : `+${count - 1} laps, ${mode === 'grey' ? 'shown grey' : 'tinted'}`;

  // --- charts -----------------------------------------------------------------
  const diffs = new Map<string, number[]>();
  if (refTrace)
    for (const r of lapRefs) {
      const t = traces.get(r.lapId);
      if (!t) continue;
      const lapS = byId.get(r.lapId)?.timeS;
      const byRef = cached(ownDiffCache, t, () => new WeakMap());
      diffs.set(
        r.lapId,
        cached(byRef, refTrace, () =>
          timeDiffS(
            t,
            refTrace,
            lapS != null && ref.timeS != null
              ? {lapS, refS: ref.timeS}
              : undefined,
          ),
        ),
      );
    }
  const valuesOf = (ch: ChannelId, lapId: string): number[] | null => {
    if (ch === 'timeDiff') return diffs.get(lapId) ?? null;
    const t = traces.get(lapId);
    return t ? CHANNELS[ch].pick(t) : null;
  };
  const samplesOf = (ch: ChannelId, lapId: string) => {
    const k = CHANNELS[ch].native;
    const t = traces.get(lapId);
    return k && t ? t.samples[k] : undefined;
  };
  // A readout is the nearest recorded sample, never an in-between value
  // (Botkin, thread 26 #392); the time diff is a grid quantity.
  const readAt = (ch: ChannelId, lapId: string, m: number) => {
    const own = samplesOf(ch, lapId);
    if (own) return nearestSample(own, m);
    const values = valuesOf(ch, lapId);
    return values
      ? values[Math.min(values.length - 1, Math.round(m / stepM))]
      : null;
  };

  // --- start/finish wrap (thread 27 #377) ------------------------------------
  // Only while the window can reach the line: elsewhere the wrap is off
  // screen, and building it every playback frame cost ~100 ms (freeze #628).
  const nearLine = windowed && (cursorM < WRAP_M || cursorM > lengthM - WRAP_M);
  const sides = new Map(
    // A lap of another session has no neighbours here: they would be that
    // session's laps, whose traces this view does not load.
    lapRefs.map(r => [
      r.lapId,
      lapNeighbours(foreignTags.has(r.lapId) ? [] : laps, r.lapId),
    ]),
  );
  const refSides = ref ? sides.get(ref.id)! : null;
  const neighbourTrace = (side: Side | undefined) =>
    side?.kind === 'lap' ? traces.get(side.lapId) : undefined;
  // The time diff across the seam compares each lap's neighbour with the
  // reference's neighbour, shifted so the line is continuous at the seam.
  const diffWrap = (lapId: string, which: 'before' | 'after') => {
    const own = diffs.get(lapId);
    const t = neighbourTrace(sides.get(lapId)?.[which]);
    const rt = refSides ? neighbourTrace(refSides[which]) : undefined;
    if (!own || !t || !rt) return undefined;
    return cached(wrapCache[which], own, () =>
      shiftedWrap(own, cachedDiff(t, rt), which),
    );
  };
  const shiftedWrap = (
    own: number[],
    d: number[],
    which: 'before' | 'after',
  ): NativeSamples => {
    const n = d.length;
    const distanceM: number[] = [];
    const values: number[] = [];
    if (which === 'before') {
      const shift = own[0] - d[n - 1];
      for (let i = 0; i < n; i++) {
        const m = i * stepM - lengthM;
        if (m >= -WRAP_M && m < 0) {
          distanceM.push(m);
          values.push(d[i] + shift);
        }
      }
    } else {
      const shift = own[own.length - 1] - d[0];
      for (let i = 1; i < n; i++) {
        const m = i * stepM + lengthM;
        if (m <= lengthM + WRAP_M) {
          distanceM.push(m);
          values.push(d[i] + shift);
        }
      }
    }
    return {distanceM, values};
  };
  const wrapOf = (ch: ChannelId, lapId: string) => {
    if (ch === 'timeDiff')
      return {
        before: diffWrap(lapId, 'before'),
        after: diffWrap(lapId, 'after'),
      };
    const k = CHANNELS[ch].native;
    const side = sides.get(lapId);
    const prev = neighbourTrace(side?.before);
    const next = neighbourTrace(side?.after);
    return {
      before:
        k && prev
          ? cached(tailCache, prev.samples[k], () =>
              tailBefore(
                prev.samples[k],
                prev.samples.speedKph.distanceM.at(-1) ?? lengthM,
              ),
            )
          : undefined,
      after:
        k && next
          ? cached(headCache, next.samples[k], () =>
              headAfter(next.samples[k], lengthM),
            )
          : undefined,
    };
  };

  const charts: ChartModel[] = (input.charts ?? DEFAULT_CHARTS).map(chs => {
    const lines: ChartLine[] = [];
    chs.forEach((ch, overlay) => {
      for (const r of lapRefs) {
        const raw = valuesOf(ch, r.lapId);
        if (!raw) continue;
        lines.push({
          ...r,
          channel: ch,
          overlay,
          values: raw,
          samples: samplesOf(ch, r.lapId),
          ...(nearLine ? wrapOf(ch, r.lapId) : {}),
        });
      }
    });
    // Channels of the same kind share a scale; mixed kinds keep their own.
    const domains: ChartModel['domains'] = {};
    for (const ch of chs) {
      const kind = CHANNELS[ch].kind;
      const sameKind = lines.filter(l => CHANNELS[l.channel].kind === kind);
      domains[ch] = domainOf(
        sameKind.map(l => l.values),
        kind,
        fitI0,
        fitI1,
        windowed,
        CHANNELS[ch].ySnap,
      );
    }
    const pedals = isPedalsChart(chs);
    if (pedals) {
      const steerM = Math.abs(domains.steering?.[1] ?? 5);
      const d = pedalsDomains(steerM);
      domains.throttle = d.pedal;
      domains.brake = d.pedal;
      domains.steering = d.steer;
    }
    const single = chs.length === 1 ? chs[0] : null;
    const bandFor =
      band && single && ['speed', 'throttle', 'brake'].includes(single)
        ? single === 'speed'
          ? band.speedKph
          : single === 'throttle'
          ? band.throttlePct
          : band.brakePct
        : null;
    const explainer = pedals
      ? 'Line = throttle, filled area = brake, both 0–100%. Bottom band = steering, % of full lock.'
      : chs.length === 1
      ? CHANNELS[chs[0]].explainer
      : chs.every(c => CHANNELS[c].kind === CHANNELS[chs[0]].kind)
      ? `${chs
          .map(
            (c, i) =>
              `${CHANNELS[c].label} ${['solid', 'dashed', 'dotted'][i]}`,
          )
          .join(', ')}. Same scale.`
      : `${chs
          .map(
            (c, i) =>
              `${CHANNELS[c].label} ${['solid', 'dashed', 'dotted'][i]}`,
          )
          .join(', ')}. Each channel keeps its own scale.`;
    return {
      key: chs.join('+'),
      channels: chs,
      title: chs.map(labelOf).join(' + '),
      explainer,
      height: pedals
        ? PEDALS_H
        : Math.max(...chs.map(c => CHANNELS[c].height)) +
          (chs.length > 1 ? 14 : 0),
      desktopHeight: pedals
        ? PEDALS_H
        : Math.max(...chs.map(c => CHANNELS[c].desktopHeight)),
      lines,
      domains,
      band: bandFor ? {low: bandFor.p10, high: bandFor.p90} : null,
      // Time diff: the reference. Steering: straight ahead, so left and
      // right lock read at a glance (Botkin, thread 26 #385).
      pedals,
      zeroLine: chs.includes('timeDiff')
        ? 'timeDiff'
        : chs.includes('steering')
        ? 'steering'
        : null,
      valueRows: chs.map((ch, overlay) => ({
        channel: ch,
        label: labelOf(ch),
        // The readout text carries the time diff's unit.
        unit: ch === 'timeDiff' ? '' : CHANNELS[ch].unit,
        overlay,
        values: keyRefs.map(r => {
          const v = readAt(ch, r.lapId, cursorM);
          return {
            lapId: r.lapId,
            selIndex: r.selIndex,
            highlighted: r.highlighted,
            text: v == null ? '—' : readoutText(ch, v),
          };
        }),
      })),
    };
  });

  // --- time per corner --------------------------------------------------------
  const sectionNs = map?.sections.map(s => s.n) ?? [];
  const cornerCount = sectionNs.length || (ref?.sections.length ?? 0);
  const corners = sectionNs.length
    ? sectionNs
    : Array.from({length: cornerCount}, (_, i) => i + 1);
  const diffRow = (lap: Lap) =>
    corners.map((_, i) => {
      const a = lap.sections[i]?.segTimeS;
      const b = ref?.sections[i]?.segTimeS;
      return a == null || b == null ? null : a - b;
    });
  let gridRows: CornerGridModel['rows'] = [];
  if (ref && cornerCount > 0) {
    const others = lapRefs.filter(r => r.selIndex > 0);
    if (mode === 'individual') {
      gridRows = others.map(r => ({
        key: r.lapId,
        label: r.label,
        lapId: r.lapId,
        selIndex: r.selIndex,
        cells: diffRow(byId.get(r.lapId)!),
      }));
    } else {
      const all = others.map(r => diffRow(byId.get(r.lapId)!));
      gridRows = [
        {
          key: 'median',
          label: 'MED',
          lapId: null,
          selIndex: null,
          cells: corners.map((_, i) =>
            median(
              all.map(row => row[i]).filter((v): v is number => v != null),
            ),
          ),
        },
        ...others
          .filter(r => r.highlighted)
          .map(r => ({
            key: r.lapId,
            label: r.label,
            lapId: r.lapId,
            selIndex: r.selIndex,
            cells: diffRow(byId.get(r.lapId)!),
          })),
      ];
    }
  }
  const grid: CornerGridModel | null =
    gridRows.length && ref
      ? {
          explainer: `Time in each section vs ${nameOf(
            ref,
          )}, in seconds. Grey = within ±0.10 s. Red + = slower, green − = faster. Tap a section to open it.`,
          corners,
          rows: gridRows,
        }
      : null;

  // --- map --------------------------------------------------------------------
  let mapModel: MapModel | null = null;
  if (refTrace) {
    const placer = mapPlacer(map, input.surface ?? null);
    const project = (t: GridTrace, stride: number) =>
      placer.place(t, 0, t.lat.length - 1, stride);
    const shown = lapRefs.filter(r => r.key || mode !== 'grey');
    const lines = shown
      .filter(r => traces.has(r.lapId))
      .map(r => ({...r, points: project(traces.get(r.lapId)!, MAP_STRIDE)}))
      // The reference and highlighted lap are drawn last, on top.
      .sort((a, b) => drawRank(a) - drawRank(b));
    const pointAt = (t: GridTrace, m: number) => {
      const i = gridIndex(t, m);
      return placer.place(t, i, i, 1)[0];
    };
    const followGeometry = input.followGeometry ?? null;
    const split = placer.outlineUse(refTrace);
    mapModel = {
      roadPending: input.surfacePending ?? false,
      realMap: placer.real,
      // The measured road first (a thin band in Track), then the OSM outside it.
      outline: [...measuredCentreLines(placer.measured), ...split.used],
      outlineFaded: split.unused,
      pitLane: placer.pitLane,
      marks: buildTrackMarks(map?.sections ?? [], lengthM, m =>
        pointAt(refTrace, m),
      ),
      follow: followGeometry && {
        ...buildFollowView(
          placer,
          refTrace,
          cursorM,
          windowed ? windowM[1] - windowM[0] : null,
        ),
        geometry: followGeometry,
      },
      lines,
      dots: keyRefs
        .filter(r => traces.has(r.lapId))
        .map(r => ({...r, at: pointAt(traces.get(r.lapId)!, cursorM)}))
        // Same order as the lines: the reference dot on top.
        .sort((a, b) => drawRank(a) - drawRank(b)),
      followPlace: followPlace(map?.sections ?? [], cursorM),
      sectionApexes: (map?.sections ?? []).map(s => ({
        n: s.n,
        apexM: s.apexM,
      })),
      attribution: placer.real ? map!.attribution : null,
    };
  }

  return {
    mode,
    // The field radar follows this session's field: a lap of another
    // session has no place in it.
    playing: playing
      ? {
          lapId: playing.id,
          lapNumber: foreignTags.has(playing.id) ? null : playing.lapNumber,
        }
      : null,
    reference: refBits.filter(Boolean).join(' · '),
    chips,
    manyChip,
    map: mapModel,
    position: {
      place: cornerPlace(map?.sections ?? [], cursorM),
      distance: formatDistance(cursorM),
    },
    grid,
    charts,
    trafficLane: trafficLaneOf(session, lapRefs, byId, lengthM),
    stepM,
    lengthM,
    windowM,
    timeAxis:
      windowed && win.mode === 'time'
        ? {ref: refTrace, windowS: windowTimeS(refTrace, cursorM, win.size!)}
        : null,
    refGrid: refTrace ?? null,
    apexMarks: windowed
      ? [
          ...(map?.sections ?? [])
            .flatMap(s => (s.parts.length ? s.parts : [s]))
            .filter(c => c.apexM >= windowM[0] && c.apexM <= windowM[1])
            .map(c => ({
              m: c.apexM,
              label: `${turnLabel(c.n, c.official)} apex`,
            })),
          ...lineMarks(refTrace, cursorM, win, lengthM, refSides),
        ]
      : [],
    pending: selected.filter(l => !traces.has(l.id)).length,
    notFound: selection.laps.length - selected.length,
    allLaps: allLapsByStint(laps, session, selection.laps),
    readouts: keyRefs.map(r => ({
      lapId: r.lapId,
      selIndex: r.selIndex,
      highlighted: r.highlighted,
      channels: Object.fromEntries(
        CHANNEL_IDS.map(ch => [ch, valuesOf(ch, r.lapId) ?? []]),
      ) as Record<ChannelId, number[]>,
      samples: Object.fromEntries(
        CHANNEL_IDS.flatMap(ch => {
          const own = samplesOf(ch, r.lapId);
          return own ? [[ch, own]] : [];
        }),
      ),
    })),
    overview: lapRefs.flatMap(r => {
      const values = diffs.get(r.lapId);
      return values
        ? [{...r, channel: 'timeDiff' as const, overlay: 0, values}]
        : [];
    }),
    sectionFirstCorner: Object.fromEntries(
      (map?.sections ?? []).map(s => [
        s.n,
        firstCornerOf(trackCorners(map!), s.n) ?? s.n,
      ]),
    ),
    sectionEntryM: Object.fromEntries(
      (map?.sections ?? []).map(s => [s.n, s.entryM]),
    ),
  };
}

function allLapsByStint(
  laps: Lap[],
  session: SessionDetail,
  selected: string[],
): AllLapsStint[] {
  const median = session.medianTimeS;
  const stints = [...new Set(laps.map(l => l.stint))];
  return stints.map(n => ({
    key: `stint-${n}`,
    label: `Stint ${n}`,
    rows: laps
      .filter(l => l.stint === n)
      .map(l => {
        const gap =
          l.comparable && l.timeS != null && median != null
            ? l.timeS - median
            : null;
        const i = selected.indexOf(l.id);
        return {
          lapId: l.id,
          label: `L${l.lapIndex}`,
          time: l.timeS == null ? '—' : formatLapTime(l.timeS),
          gap: gap == null ? null : formatGap(gap),
          gapFaster: gap != null && gap < 0,
          comparable: l.comparable,
          tag:
            l.id === session.bestLapId
              ? 'BEST'
              : l.pitOut
              ? 'OUT'
              : l.pitIn
              ? 'IN'
              : l.partialWhy === 'grid'
              ? 'PARK'
              : l.partial
              ? 'PART'
              : l.reasons.includes('slow')
              ? 'SLOW'
              : null,
          selIndex: i < 0 ? null : i,
        };
      }),
  }));
}

/** Adds a lap to the comparison, or removes it; the reference stays. */
export function toggleCompared(
  sel: CompareSelection,
  lapId: string,
): CompareSelection {
  if (sel.laps[0] === lapId) return sel;
  return sel.laps.includes(lapId)
    ? removeLap(sel, lapId)
    : {...sel, laps: [...sel.laps, lapId]};
}

/** Draw order: other laps, then the highlighted lap, then the reference on top. */
export const drawRank = (r: {selIndex: number; highlighted: boolean}) =>
  r.selIndex === 0 ? 2 : r.highlighted ? 1 : 0;

// --- selection edits (pure; the route writes them to the URL) ----------------

/**
 * A URL with no laps opens on the session's default laps (a fair reference
 * and the median lap, `referenceDefaultLapIds`), so Compare is never an empty
 * reference with no chips. Laps the URL names are kept as given, and nothing
 * changes while the session or its laps are still loading.
 */
export function withDefaultLaps(
  sel: CompareSelection,
  laps: Lap[] | undefined,
  session: DefaultSession | undefined,
): CompareSelection {
  if (sel.laps.length > 0 || !laps || !session) return sel;
  return {...sel, laps: referenceDefaultLapIds(laps, session)};
}

export function makeReference(
  sel: CompareSelection,
  lapId: string,
): CompareSelection {
  if (sel.laps[0] === lapId || !sel.laps.includes(lapId)) return sel;
  const prev = sel.laps[0];
  return {
    ...sel,
    laps: [lapId, ...sel.laps.filter(id => id !== lapId)],
    hl: sel.hl === lapId ? prev : sel.hl,
  };
}

/**
 * Makes a lap the reference in one step, adding it to the comparison first
 * when it is not there (a lap from All laps). The old reference stays in the
 * comparison as an ordinary lap.
 */
export function setReference(
  sel: CompareSelection,
  lapId: string,
): CompareSelection {
  if (sel.laps[0] === lapId) return sel;
  const added = sel.laps.includes(lapId)
    ? sel
    : {...sel, laps: [...sel.laps, lapId]};
  return makeReference(added, lapId);
}

/** The reference never goes, and neither does the last compared lap: removing it snaps the selection back to the default. */
export function canRemoveLap(sel: CompareSelection, lapId: string): boolean {
  return sel.laps[0] !== lapId && sel.laps.length > 2;
}

export function removeLap(
  sel: CompareSelection,
  lapId: string,
): CompareSelection {
  if (sel.laps[0] === lapId) return sel;
  return {
    ...sel,
    laps: sel.laps.filter(id => id !== lapId),
    hl: sel.hl === lapId ? null : sel.hl,
  };
}
