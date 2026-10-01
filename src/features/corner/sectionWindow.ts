// The Corner screen's window for one section (pit-wall thread 45, #1590): the
// stretch from one boundary to the next, with the time in it split into
// run-in, corner and exit, the four speeds that tell the story without the
// trace, and the brake applications by the corner each is for. Pure: laps and
// the map's boundaries in, strings and numbers out. Numbers, units and what
// they were measured against, never advice (CODE_STANDARDS §7).
//
// Laps are only compared on the boundaries' own revision: a lap cut at older
// boundaries says "re-analysis pending", never a mixed comparison (setup,
// #1630). A window the pit lane crosses is greyed on its own; the rest of the
// lap still counts.
import {
  type BoundaryWindow,
  type Lap,
  type MapBoundaries,
  type MapSection,
  sessionOptimum,
  type TrackMapData,
} from '@/src/data/sessions';
import {formatDistance, formatGap, turnLabel} from '@/src/design';

export type WindowRowState =
  /** Cut at the current boundaries: compared. */
  | 'ok'
  /** No window facts, or cut at other boundaries: shown as pending. */
  | 'stale'
  /** The pit lane overlaps this window. */
  | 'pit';

export type Cell = {value: string; gap: string | null; better: boolean};

export type BrakeAppLine = {
  /** "Brake 1". */
  label: string;
  /** "210 m before T9". */
  onset: string;
  /** "92 %". */
  peak: string;
  /** The corner braked for, "T9"; null for a single corner. */
  part: string | null;
};

export type SectionWindowRow = {
  lapId: string;
  label: string;
  state: WindowRowState;
  time: Cell;
  runIn: Cell;
  corner: Cell;
  exit: Cell;
  /** What the lap brought in, the slowest point (and where), full throttle, and the exit carried on. */
  speeds: {
    onset: string;
    min: string;
    fullThrottle: string;
    end: string;
  };
  brakes: BrakeAppLine[];
};

/** One stint's best and median for this window, over the laps that count in it. */
export type WindowOptimumRow = {
  /** "Stint 2". */
  label: string;
  /** Times that counted: "14 laps". */
  n: string;
  best: string;
  /** The lap the best came from, "L14". */
  bestLap: string;
  median: string;
  /** Median minus best, signed. */
  gap: string;
};

export type SectionWindowModel = {
  /** "S5 (T8–T10)". */
  label: string;
  /** "3,665 → 4,005 m". */
  span: string;
  fromM: number;
  toM: number;
  /** The parts of a compound section to drill into; empty for one corner. */
  parts: {n: number; label: string; fromM: number; toM: number}[];
  rows: SectionWindowRow[];
  /** Per stint of 5 or more laps, the window's best and median over every comparable lap; empty under 5 times. */
  optimum: WindowOptimumRow[];
  /** Laps shown as "re-analysis pending". */
  pendingCount: number;
  /**
   * Said on the card when the first lap (the reference) cannot be compared,
   * so empty gap cells are never the only sign: "Reference L12 is pending
   * re-analysis; no gaps." Null when the reference compares, or no lap does.
   */
  referenceNote: string | null;
};

const kph = (v: number | null) => (v == null ? '—' : `${Math.round(v)} km/h`);

function sectionLabel(section: MapSection): string {
  const cs = section.parts.length ? section.parts : [section];
  const name = (c: MapSection['parts'][number]) => turnLabel(c.n, c.official);
  const first = name(cs[0]);
  const last = name(cs[cs.length - 1]);
  return `S${section.n} (${cs.length > 1 ? `${first}–${last}` : first})`;
}

const seconds = (v: number | null) => (v == null ? '—' : v.toFixed(3));

function gapOf(v: number | null, ref: number | null, isRef: boolean) {
  if (v == null || ref == null || isRef) return null;
  return v - ref;
}

function cell(v: number | null, ref: number | null, isRef: boolean): Cell {
  const d = gapOf(v, ref, isRef);
  return {
    value: seconds(v),
    gap: d == null ? null : formatGap(d),
    better: d != null && d < 0,
  };
}

const EMPTY_CELL: Cell = {value: '—', gap: null, better: false};

/**
 * The window of one section for the laps shown, in order (the first is the
 * reference). Null when the track has no boundaries yet or no such section.
 */
export function buildSectionWindow(input: {
  map: TrackMapData;
  sectionN: number;
  laps: Lap[];
  /** Every lap of the session, for the window's best and median. */
  sessionLaps?: Lap[];
}): SectionWindowModel | null {
  const {map, sectionN, laps} = input;
  const boundaries = map.boundaries;
  if (!boundaries) return null;
  const index = map.sections.findIndex(s => s.n === sectionN);
  const window = boundaries.windows.find(
    (w): w is BoundaryWindow => w.kind === 'section' && w.section === sectionN,
  );
  if (index < 0 || !window) return null;
  const section = map.sections[index];

  const stateOf = (lap: Lap): WindowRowState => {
    const facts = lap.sections[index];
    if (!facts?.window || !isCurrent(lap, boundaries)) return 'stale';
    return facts.window.pit ? 'pit' : 'ok';
  };
  const states = laps.map(stateOf);
  const refIndex = states[0] === 'ok' ? 0 : -1;
  const refFacts = refIndex === 0 ? laps[0].sections[index] : null;

  // A brake application is measured to the apex of the corner braked for.
  const apexOf = (part: number | null) =>
    section.parts.find(p => p.n === part)?.apexM ?? section.apexM;
  const labelOf = (part: number | null) => {
    const p = section.parts.find(c => c.n === part);
    return p ? turnLabel(p.n, p.official) : null;
  };

  const rows: SectionWindowRow[] = laps.map((lap, i) => {
    const state = states[i];
    const base = {lapId: lap.id, label: `L${lap.lapIndex}`, state};
    const facts = lap.sections[index];
    const w = facts?.window;
    if (state === 'stale' || !facts || !w) {
      return {
        ...base,
        time: EMPTY_CELL,
        runIn: EMPTY_CELL,
        corner: EMPTY_CELL,
        exit: EMPTY_CELL,
        speeds: {onset: '—', min: '—', fullThrottle: '—', end: '—'},
        brakes: [],
      };
    }
    // A greyed window still shows what it measured, but is not compared.
    const compare = state === 'ok';
    const rw = refFacts?.window ?? null;
    const isRef = i === refIndex;
    const gapFrom = (v: number | null, r: number | null | undefined) =>
      cell(v, compare ? r ?? null : null, isRef);
    const minWhere =
      facts.minSpeedKph == null || w.minSpeedAtM == null
        ? ''
        : ` at ${formatDistance(w.minSpeedAtM)}${
            w.minSpeedPart != null
              ? ` in ${labelOf(w.minSpeedPart) ?? `T${w.minSpeedPart}`}`
              : ''
          }`;
    return {
      ...base,
      time: gapFrom(facts.segTimeS, refFacts?.segTimeS),
      runIn: gapFrom(w.runInS, rw?.runInS),
      corner: gapFrom(w.cornerS, rw?.cornerS),
      exit: gapFrom(w.exitS, rw?.exitS),
      speeds: {
        onset: kph(w.onsetSpeedKph),
        min: `${kph(facts.minSpeedKph)}${minWhere}`,
        fullThrottle: kph(w.fullThrottleSpeedKph),
        end: kph(w.endSpeedKph),
      },
      brakes: facts.brakeApps.map((a, k) => {
        const part = labelOf(a.part);
        return {
          label: `Brake ${k + 1}`,
          onset: `${Math.round(apexOf(a.part) - a.onsetM)} m before ${
            part ?? 'the apex'
          }`,
          peak: `${Math.round(a.peakPct)} %`,
          part,
        };
      }),
    };
  });

  return {
    label: sectionLabel(section),
    span: `${Math.round(window.fromM).toLocaleString('en-US')} → ${Math.round(
      window.toM,
    ).toLocaleString('en-US')} m`,
    fromM: window.fromM,
    toM: window.toM,
    parts: window.parts.map(p => {
      const c = section.parts.find(x => x.n === p.n);
      return {
        n: p.n,
        label: turnLabel(p.n, c?.official),
        fromM: p.fromM,
        toM: p.toM,
      };
    }),
    rows,
    optimum: optimumRows(input.sessionLaps ?? laps, map, sectionN),
    pendingCount: states.filter(s => s === 'stale').length,
    referenceNote:
      laps.length > 1 && states[0] !== 'ok'
        ? `Reference L${laps[0].lapIndex} ${
            states[0] === 'stale'
              ? 'is pending re-analysis'
              : 'crosses the pit lane here'
          }; no gaps.`
        : null,
  };
}

function optimumRows(
  laps: Lap[],
  map: TrackMapData,
  sectionN: number,
): WindowOptimumRow[] {
  const optimum = sessionOptimum(laps, map);
  const lapIndexOf = new Map(laps.map(l => [l.id, l.lapIndex]));
  const at = optimum?.windows.findIndex(
    w => w.kind === 'section' && w.section === sectionN,
  );
  if (!optimum || at == null || at < 0) return [];
  const rows: WindowOptimumRow[] = [];
  for (const s of optimum.stints) {
    const w = s.windows[at];
    if (w.bestS == null || w.medianS == null) continue;
    rows.push({
      label: `Stint ${s.stint}`,
      n: `${w.n} laps`,
      best: seconds(w.bestS),
      bestLap: `L${lapIndexOf.get(w.bestLapId ?? '') ?? '?'}`,
      median: seconds(w.medianS),
      gap: formatGap(w.medianS - w.bestS),
    });
  }
  return rows;
}

/** Whether a lap's windows were cut at the boundaries the map carries now. */
export function isCurrent(lap: Lap, boundaries: MapBoundaries): boolean {
  const stamp = lap.cornerBoundaries;
  return (
    stamp != null && stamp.v === boundaries.v && stamp.rev === boundaries.rev
  );
}
