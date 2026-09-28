import {
  applyGeoref,
  canDrawOnRealMap,
  LMU_FAKE_ORIGIN,
  toLocalMetres,
} from '@/src/analysis/geo';
import {type GridTrace, gridIndex, timeDiffS} from '@/src/analysis/resample';
import {
  rebaseToWindow,
  type WindowMode,
  windowRange,
} from '@/src/analysis/window';
import {CHANNEL_IDS, type ChannelId, PRESETS} from '@/src/state/comparePrefs';
import {
  firstCornerOf,
  type Lap,
  type SessionBand,
  type SessionDetail,
  type TrackMapData,
  trackCorners,
} from '@/src/data/sessions';
import {
  formatDistance,
  formatGap,
  formatLapTime,
  lapMode,
  type LapMode,
} from '@/src/design';

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

export type {ChannelId} from '@/src/state/comparePrefs';

type ChannelSpec = {
  label: string;
  unit: string;
  explainer: string;
  /** Shared scale for channels of the same kind. */
  kind: 'time' | 'speed' | 'pedal' | 'steer' | 'gear';
  height: number;
  /** Desktop workspace height (handoff D2). */
  desktopHeight: number;
  format: (v: number) => string;
  pick: (t: GridTrace) => number[];
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
    height: 104,
    desktopHeight: 150,
    format: v => v.toFixed(0),
    pick: t => t.speedKph,
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
  },
  steering: {
    label: 'Steering',
    // LMU records steering as % of lock, not degrees (docs/LMU_SYNC_NOTES.md).
    unit: '% lock',
    explainer: 'Steering, as % of full lock. Extra wiggles are corrections.',
    kind: 'steer',
    height: 56,
    desktopHeight: 84,
    format: v => v.toFixed(0),
    pick: t => t.steeringPct,
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
  },
};

/** Default chart set: [Time diff] [Speed] [Throttle + Brake] [Steering] [Gear]. */
export const DEFAULT_CHARTS: ChannelId[][] = PRESETS[0].charts;

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
  values: number[];
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
  zeroLine: boolean;
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
  realMap: boolean;
  outline: {x: number; y: number}[][];
  lines: (LapRef & {points: {x: number; y: number}[]})[];
  dots: (LapRef & {at: {x: number; y: number}})[];
  badges: {
    n: number;
    at: {x: number; y: number};
    /** Apex distance, for the strip. */
    apexM: number;
    open: boolean;
  }[];
  attribution: string | null;
};

export type CompareModel = {
  mode: LapMode;
  reference: string;
  chips: Chip[];
  manyChip: string | null;
  map: MapModel | null;
  position: {
    place: string;
    distance: string;
    speeds: {
      lapId: string;
      selIndex: number;
      highlighted: boolean;
      text: string;
    }[];
  };
  grid: CornerGridModel | null;
  charts: ChartModel[];
  stepM: number;
  lengthM: number;
  /** Visible distance range of the charts, metres. */
  windowM: [number, number];
  /** The reference lap on the grid: time and distance for pan and playback. */
  refGrid: GridTrace | null;
  /** Corner apex lines inside the window, e.g. "C6 apex". */
  apexMarks: {m: number; label: string}[];
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
};

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
      const v = a.length ? a[Math.min(a.length - 1, i)] : null;
      return {
        lapId: r.lapId,
        selIndex: r.selIndex,
        highlighted: r.highlighted,
        text: v == null ? '—' : CHANNELS[ch].format(v),
      };
    }),
  }));
}

export type CompareInputs = {
  session: SessionDetail;
  laps: Lap[];
  /** Resampled traces by lap id; missing while loading. */
  traces: Map<string, GridTrace>;
  band: SessionBand | null;
  map: TrackMapData | null;
  selection: CompareSelection;
  charts?: ChannelId[][];
  window?: ChartWindow;
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

function domainOf(
  arrays: number[][],
  kind: ChannelSpec['kind'],
  from: number,
  to: number,
  windowed: boolean,
): [number, number] {
  // Pedals are fixed at −4..104 so 0 and 100 never sit on the edge.
  if (kind === 'pedal') return [-4, 104];
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of arrays)
    for (let i = Math.max(0, from); i <= Math.min(a.length - 1, to); i++) {
      const v = a[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  if (!Number.isFinite(lo)) return [0, 1];
  if (kind === 'time') {
    // Symmetric around 0; the floor keeps a flat line from filling the chart.
    const m = Math.max(Math.abs(lo), Math.abs(hi), windowed ? 0.02 : 0.1);
    return [-m, m];
  }
  if (kind === 'steer') {
    const m = Math.max(Math.abs(lo), Math.abs(hi), 5);
    return [-m, m];
  }
  if (kind === 'gear') return [Math.min(lo, 1) - 0.5, hi + 0.5];
  const pad = (hi - lo) * 0.05 || 1;
  return [lo - pad, hi + pad];
}

const WINDOWED_TIME_EXPLAINER =
  'Time gained or lost within this window, starting from 0 at its left edge. Line rising = losing time. Values are the total gap at the cursor.';

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

export function buildCompareModel(input: CompareInputs): CompareModel {
  const {session, laps, traces, band, map, selection} = input;
  const byId = new Map(laps.map(l => [l.id, l]));
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

  const lapRefs: LapRef[] = selected.map((l, i) => ({
    lapId: l.id,
    label: `L${l.lapIndex}`,
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

  // --- reference line and chips ---------------------------------------------
  const refBits = ref
    ? [
        `L${ref.lapIndex}`,
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
      diffs.set(
        r.lapId,
        timeDiffS(
          t,
          refTrace,
          lapS != null && ref.timeS != null
            ? {lapS, refS: ref.timeS}
            : undefined,
        ),
      );
    }
  const valuesOf = (ch: ChannelId, lapId: string): number[] | null => {
    if (ch === 'timeDiff') return diffs.get(lapId) ?? null;
    const t = traces.get(lapId);
    return t ? CHANNELS[ch].pick(t) : null;
  };
  const at = (values: number[] | null) =>
    values
      ? values[Math.min(values.length - 1, Math.round(cursorM / stepM))]
      : null;

  const charts: ChartModel[] = (input.charts ?? DEFAULT_CHARTS).map(chs => {
    const lines: ChartLine[] = [];
    chs.forEach((ch, overlay) => {
      for (const r of lapRefs) {
        const raw = valuesOf(ch, r.lapId);
        if (!raw) continue;
        const values =
          ch === 'timeDiff' && windowed ? rebaseToWindow(raw, i0) : raw;
        lines.push({...r, channel: ch, overlay, values});
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
        i0,
        i1,
        windowed,
      );
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
    const explainer =
      chs.length === 1
        ? chs[0] === 'timeDiff' && windowed
          ? WINDOWED_TIME_EXPLAINER
          : CHANNELS[chs[0]].explainer
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
      title: chs.map(c => CHANNELS[c].label).join(' + '),
      explainer,
      height:
        Math.max(...chs.map(c => CHANNELS[c].height)) +
        (chs.length > 1 ? 14 : 0),
      desktopHeight: Math.max(...chs.map(c => CHANNELS[c].desktopHeight)),
      lines,
      domains,
      band: bandFor ? {low: bandFor.p10, high: bandFor.p90} : null,
      zeroLine: chs.includes('timeDiff'),
      valueRows: chs.map((ch, overlay) => ({
        channel: ch,
        label: CHANNELS[ch].label,
        unit: CHANNELS[ch].unit,
        overlay,
        values: keyRefs.map(r => {
          const v = at(valuesOf(ch, r.lapId));
          return {
            lapId: r.lapId,
            selIndex: r.selIndex,
            highlighted: r.highlighted,
            text: v == null ? '—' : CHANNELS[ch].format(v),
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
          explainer: `Time in each section vs L${ref.lapIndex}, in seconds. Grey = within ±0.10 s. Red + = slower, green − = faster. Tap a section to open it.`,
          corners,
          rows: gridRows,
        }
      : null;

  // --- map --------------------------------------------------------------------
  let mapModel: MapModel | null = null;
  if (refTrace) {
    const real = map != null && canDrawOnRealMap(map.quality, map.georef);
    const origin = real
      ? {lat: map!.georef!.originLat, lon: map!.georef!.originLon}
      : LMU_FAKE_ORIGIN;
    const project = (t: GridTrace, stride: number) => {
      const pts = [];
      for (let i = 0; i < t.lat.length; i += stride)
        pts.push({lat: t.lat[i], lon: t.lon[i]});
      const placed = real ? applyGeoref(pts, map!.georef!) : pts;
      return placed.map(p => toLocalMetres(p, origin));
    };
    const shown = lapRefs.filter(r => r.key || mode !== 'grey');
    const lines = shown
      .filter(r => traces.has(r.lapId))
      .map(r => ({...r, points: project(traces.get(r.lapId)!, MAP_STRIDE)}))
      // The reference and highlighted lap are drawn last, on top.
      .sort((a, b) => drawRank(a) - drawRank(b));
    const pointAt = (t: GridTrace, m: number) => {
      const i = gridIndex(t, m);
      return project({...t, lat: [t.lat[i]], lon: [t.lon[i]]}, 1)[0];
    };
    mapModel = {
      realMap: real,
      outline: real
        ? map!.outline.map(line =>
            line.map(([lon, lat]) => toLocalMetres({lat, lon}, origin)),
          )
        : [],
      lines,
      dots: keyRefs
        .filter(r => traces.has(r.lapId))
        .map(r => ({...r, at: pointAt(traces.get(r.lapId)!, cursorM)}))
        // Same order as the lines: the reference dot on top.
        .sort((a, b) => drawRank(a) - drawRank(b)),
      badges: (map?.sections ?? []).map(s => ({
        n: s.n,
        at: pointAt(refTrace, s.apexM),
        apexM: s.apexM,
        open: s.n === selection.corner,
      })),
      attribution: real ? map!.attribution : null,
    };
  }

  return {
    mode,
    reference: refBits.filter(Boolean).join(' · '),
    chips,
    manyChip,
    map: mapModel,
    position: {
      place: cornerPlace(map?.sections ?? [], cursorM),
      distance: formatDistance(cursorM),
      speeds: keyRefs.map(r => {
        const v = at(traces.get(r.lapId)?.speedKph ?? null);
        return {
          lapId: r.lapId,
          selIndex: r.selIndex,
          highlighted: r.highlighted,
          text: v == null ? '—' : v.toFixed(0),
        };
      }),
    },
    grid,
    charts,
    stepM,
    lengthM,
    windowM,
    refGrid: refTrace ?? null,
    apexMarks: windowed
      ? (map?.sections ?? [])
          .flatMap(s => (s.parts.length ? s.parts : [s]))
          .filter(c => c.apexM >= windowM[0] && c.apexM <= windowM[1])
          .map(c => ({m: c.apexM, label: `C${c.n} apex`}))
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
