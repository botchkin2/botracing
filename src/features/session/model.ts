import {basisOf} from '@/src/analysis/lapBasis';
import {useMemo} from 'react';

import type {StripLap} from './lapStrip';
import {lapSlots} from '@/src/analysis/lapSlots';
import type {RaceFacts} from '@/src/analysis/fuelPlan';
import {
  type SectionMode,
  type SegmentStats,
  type SegmentTimes,
} from '@/src/analysis/segments';

import {
  defaultSessionOf,
  firstCornerOf,
  openingLapIds,
  raceFactsOfPlan,
  dayBestLapId,
  type DaySet,
  type Lap,
  type SessionDetail,
  sectorSegmentTimes,
  segmentTimesFor,
  trackCorners,
  type TrackMapData,
  useSession,
  useSessionLaps,
  useTrackMap,
} from '@/src/data/sessions';
import {
  carLabel,
  dayMonthOf,
  formatDayMonthTime,
  formatGap,
  formatClock,
  formatLapTime,
  modeText,
  shortTrackName,
} from '@/src/design';
import {planComboKey} from '@/src/nav/routes';
import {useSectionMode} from '@/src/state/sectionPrefs';

import {lapFuelLines, pitLine, stintFuelLine} from './fuelLines';
import {buildFuelUse, type FuelUse} from './fuelUse';
import {optimumFacts} from './optimumFacts';
import {type OptimumLine, optimumLines} from './optimumLines';
import {lapTimeStats, segmentBasisStats, stintNumbers} from './selectionStats';
import {energyLine, type EnergyLine} from './energyLine';
import {classTable, type ClassTable} from './classTable';
import {buildPitCard, type PitCard} from './pitCard';
import {buildTiresCard, type TiresCard} from './tireCard';
import {lapTraffic, orderTags, trafficTags} from './lapTags';
import {
  paceSplit,
  setText,
  stintTrafficText,
  type TrafficRow,
  trafficRows,
} from './trafficFacts';
import {isCompound} from '@/src/data/sessions/corners';
import {type BrakeRow, brakeLedger} from './brakeLedger';
import {type SpreadRow, spreadRows} from './spreadRows';
import {MIN_COMPARISON_LAPS} from '@/src/analysis/setStats';

// Session screen view model (handoff §2). buildSessionModel is pure: session,
// laps and the URL selection in, everything the screen draws out. Colors are
// not decided here; `selIndex` (analysis/lapSlots.ts: 0 only for a picked Ref,
// the rest by lap number from 1, as in Compare) picks the lap color.

export type Selection = {
  /** Checked lap ids; their order carries no meaning. */
  laps: string[];
  /** The Ref lap when one is picked; absent, the checked laps are measured against their own median. */
  ref?: string | null;
  /** The highlighted (tapped) lap. */
  hl: string | null;
};

/**
 * A head fact. `basis` names the laps it is over when that is not obvious
 * ("session" for a fact of the whole session, "of 13" for a comparison over the
 * selection): every number names its set (decision 2026-10-11).
 */
export type Fact = {
  label: string;
  value: string;
  best?: boolean;
  basis?: string;
};

/** The label as the head prints it: "Best · session", "Median · of 13". */
export const factLabel = (f: Fact): string =>
  f.basis ? `${f.label} · ${f.basis}` : f.label;

export type Bar = {
  lapId: string;
  lapIndex: number;
  comparable: boolean;
  /** Median minus lap time, clamped to ±BAR_CLAMP_S. Up (positive) = faster. */
  deltaS: number;
  best: boolean;
  /** Towed for TOW_HOLLOW_S or more: drawn as an outline (R3c). */
  hollow: boolean;
  selIndex: number | null;
  highlighted: boolean;
};

export type ChartModel = {
  bars: Bar[];
  /** Lap index after which a new stint starts. */
  stintBreaks: {afterLap: number; label: string}[];
  /** Lap index of each pit-in lap. */
  pits: number[];
  /** Lap index of each lap a reset to the garage cut short. */
  resets: number[];
  /**
   * Lap indexes for the rails under the chart (R3c); null when the session
   * has no field, so no rail claims a clean race.
   */
  rails: {tow: number[]; tick: number[]; pit: number[]} | null;
};

export type Tag = {code: string; best?: boolean};

export type LapRowModel = {
  kind: 'lap';
  lapId: string;
  label: string;
  stint: number;
  time: string;
  gap: string | null;
  gapFaster: boolean;
  /** The game's sectors: the phone table, until it reads the sections too. */
  sectors: {value: string; best: boolean}[];
  /** One cell per section, in the order of `SessionScreenModel.sections.heads` (the desktop table). */
  sections: {value: string; best: boolean}[];
  tags: Tag[];
  comparable: boolean;
  selIndex: number | null;
  highlighted: boolean;
};

export type StintRowModel = {
  kind: 'stint';
  key: string;
  label: string;
  /** Comparable lap ids in the stint, for "Select stint". */
  lapIds: string[];
  /** In a day, the session the stint belongs to: a tap opens it. */
  sessionId?: string;
};

/** A line of text under a stint header or a pit lap: same height as a lap row. */
export type NoteRowModel = {
  kind: 'note';
  key: string;
  text: string;
  /** Set on a pit line: the lap the pit lane was entered, which the Pit stops card names its column by. */
  pitLapIndex?: number;
};

export type RowModel = LapRowModel | StintRowModel | NoteRowModel;

export type DetailModel = {
  lapId: string;
  title: string;
  status: string;
  excluded: boolean;
  /** Fuel and Virtual Energy on the lap, one line each (fuelLines.ts). */
  fuel: string[];
  /** Seconds and counts from the field; null on a lap without one (round 7, 2B). */
  traffic: TrafficRow[] | null;
  action: 'add' | 'remove';
};

/** One stint the tray can select in a tap (D16/D17): its comparable laps. */
export type StintPick = {
  n: number;
  /** "2", under a Stint label (S1-S3 are the sector heads). */
  label: string;
  lapIds: string[];
  /** The selection is exactly this stint's comparable laps. */
  active: boolean;
};

export type TrayModel = {
  laps: {lapId: string; selIndex: number}[];
  label: string;
  count: number;
  /** Two or more stints with comparable laps; empty otherwise (one stint is already the default set). */
  stints: StintPick[];
};

/** The desktop Laps table's section columns: their heads, and the median, best and spread rows under it. */
export type SectionTable = {
  heads: string[];
  /** The map section each head is (null for the start straight and the game's sectors). */
  sections: (number | null)[];
  /**
   * Where a cell in each column opens Corner: the section's first corner (its
   * number, not the section's), and whether the section is compound (opens
   * on All: "for compound turns, default select all"). Null for the start
   * straight and the game's sectors.
   */
  targets: {corner: number | null; whole: boolean}[];
  footer: {label: string; cells: string[]}[];
};

export type SessionScreenModel = {
  title: string;
  subtitle: string;
  /** For the link to the layout's Track page. */
  trackId: string;
  /** The lap strip's data: every lap in driving order (src/features/session/lapStrip.ts). */
  strip: StripLap[];
  facts: Fact[];
  /** The optimal lap per stint; empty before the sections or under 5 laps. */
  optimum: Fact[];
  /** The phone's line under the chart, one per stint. */
  optimumLines: OptimumLine[];
  /** Null while no lap has sections or sector times. */
  sections: SectionTable | null;
  /** The sections that hold the most of the set's lap-to-lap spread; empty under 10 laps (spreadRows.ts). */
  spread: SpreadRow[];
  /** The loosest braking zones: where each lap began to brake against the median; empty under 10 laps (brakeLedger.ts). */
  brake: BrakeRow[];
  /** The game's sector columns (S1..Sn) when laps carry sector times; none otherwise. */
  sectorHeads: string[];
  chart: ChartModel | null;
  noComparable: {title: string; reasons: string[]} | null;
  rows: RowModel[];
  detail: DetailModel | null;
  tray: TrayModel | null;
  /** Energy at the start and end of the session, one line under the facts; null without readings. */
  energy: EnergyLine | null;
  /** The fastest cars of each class, from the field; null without it or before the session is analysed with it. */
  classTable: ClassTable | null;
  /** Races with a stop only. */
  pitCard: PitCard | null;
  /** Per-wheel wear, pressure and rubber temperature by stint. */
  tires: TiresCard | null;
  /** A heal replaced this session's live copy: its one header line and the detail a tap opens; null otherwise. */
  rebuilt: {line: string; detail: string} | null;
  /** This session was replaced by a healed one: its link goes there. */
  movedTo: string | null;
  /** Practice with green laps only. */
  fuelUse: FuelUseCardModel | null;
  /** Races with a whole lap to end on. */
  planVsRace: RaceFacts | null;
};

/** The practice fuel card: the numbers, and the plan they belong to. */
export type FuelUseCardModel = {
  fuelUse: FuelUse;
  /** A Plan combo key (track|car), to open the plan on this session's track and car. */
  planKey: string;
  /** "Road Atlanta · 911 GT3 R". */
  planLabel: string;
  /** Green laps the plan can read from this session. */
  greenLaps: number;
};

/** The Plan screen's key for this session's track and car. */
function planKeyOf(session: SessionDetail): string {
  return planComboKey(
    session.trackId,
    carLabel(session.car).model,
    session.sim,
  );
}

function buildFuelUseCard(
  session: SessionDetail,
  laps: Lap[],
): FuelUseCardModel | null {
  const fuelUse = buildFuelUse(session, laps);
  if (!fuelUse) return null;
  const car = carLabel(session.car);
  return {
    fuelUse,
    // The same key the Plan screen builds for its track+car choices.
    planKey: planKeyOf(session),
    planLabel: `${shortTrackName(session.track)} · ${car.shortModel}`,
    greenLaps: laps.filter(
      l => l.fuel?.green && (l.fuel.usedL ?? 0) > 0 && l.timeS != null,
    ).length,
  };
}

/**
 * The clean median beside the overall median, never instead of it (Botkin,
 * pit-wall thread 44 #1563): the headline pace stays every comparable lap. It
 * shows the laps it uses and is left out under the 3-lap floor or before a
 * field's traffic block is analysed. A session with no field says so, once.
 * The traffic median is gone: it was accented and told him nothing (triage #13).
 */
export function trafficPaceFacts(
  session: SessionDetail,
  basisLaps: Lap[],
): Fact[] {
  const {field} = session;
  // Of the basis laps, like every other median on the screen and the stint
  // headers' own clean median (one answer to "clean median"), not the stored
  // whole-session value.
  const traffic = paceSplit(basisLaps);
  if (traffic == null)
    return field == null
      ? [{label: 'Clean median', value: 'No other cars recorded'}]
      : [];
  const facts: Fact[] = [];
  const value = setText(
    traffic.clean,
    basisLaps.filter(l => l.comparable).length,
  );
  if (value) facts.push({label: 'Clean median', value});
  return facts;
}

export const BAR_CLAMP_S = 1.5;

const TYPE_TITLE = {R: 'Race', Q: 'Qualifying', P: 'Practice'} as const;
const lapLabel = (lap: Lap) => `L${lap.lapIndex}`;
const timeOrDash = (t: number | null) => (t == null ? '—' : formatLapTime(t));
const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));

/** The outcomes that delete the lap they land in (tools/sessions/resultsInput.mjs). */
const DELETING: ReadonlySet<string> = new Set([
  'warning',
  'invalidCut',
  'invalidOff',
]);

/** "Invalid", and the game's words for the strike that deleted the lap when its results file has one. */
function invalidWhy(lap: Lap): string {
  const ruling = lap.trackLimits?.find(
    k => DELETING.has(k.outcome) && k.ruling,
  )?.ruling;
  return ruling ? `Invalid · ${ruling}` : 'Invalid';
}

function tagsFor(lap: Lap, bestLapId: string | null): Tag[] {
  const tags: Tag[] = [];
  if (lap.id === bestLapId) tags.push({code: 'BEST', best: true});
  if (lap.pitOut) tags.push({code: 'OUT'});
  if (lap.pitIn) tags.push({code: 'IN'});
  // A lap cut short by a reset says so, instead of the generic PART.
  if (lap.endedInReset) tags.push({code: 'RESET'});
  else if (lap.partialWhy === 'grid') tags.push({code: 'PARK'});
  // A whole lap the game did not time is invalid, not partial (L25 of
  // 682524ed, 2026-10-14: a full lap between two full laps read PART).
  else if (lap.invalidTimeS != null) tags.push({code: 'INV'});
  else if (lap.partial || lap.reasons.includes('untimed'))
    tags.push({code: 'PART'});
  if (lap.reasons.includes('slow')) tags.push({code: 'SLOW'});
  // The game's own rulings in this lap (its results file), counted: what it
  // ruled is the status line's, never ours.
  if (lap.trackLimits?.length)
    tags.push({code: `LIM ${lap.trackLimits.length}`});
  if (lap.hadImpact) tags.push({code: 'HIT'});
  tags.push(...trafficTags(lap.traffic));
  return orderTags(tags);
}

function statusFor(
  lap: Lap,
  medianS: number | null,
  /** Laps the median is of. */
  n: number,
): string {
  if (!lap.comparable) {
    const why = lap.pitOut
      ? 'Pit out'
      : lap.pitIn
      ? 'Pit in'
      : lap.endedInReset
      ? 'Reset'
      : lap.partialWhy === 'grid'
      ? 'Parked start'
      : lap.invalidTimeS != null
      ? invalidWhy(lap)
      : lap.partial || lap.reasons.includes('untimed')
      ? 'Partial'
      : lap.reasons.includes('slow')
      ? 'Slow outlier'
      : 'Not comparable';
    return `Excluded · ${why}`;
  }
  if (lap.timeS == null || medianS == null || n < MIN_COMPARISON_LAPS)
    return 'Comparable';
  return `Comparable · ${formatGap(lap.timeS - medianS)} s vs median of ${n}`;
}

const dash = '—';

/** A lap's cell in each segment: the time, and whether it is the best of the basis laps (the grid's best). */
function cellsOf(
  times: SegmentTimes | null,
  basis: ReadonlySet<string>,
  digits: number,
): (lapId: string) => {value: string; best: boolean}[] {
  if (!times) return () => [];
  const stats = segmentBasisStats(times, basis);
  const byId = new Map(times.laps.map(l => [l.id, l]));
  return lapId => {
    const lap = byId.get(lapId);
    return times.segments.map((_, i) => {
      const t = lap?.timesS[i] ?? null;
      return {
        value: t == null ? dash : t.toFixed(digits),
        best: basis.has(lapId) && t != null && t === stats[i].bestS,
      };
    });
  };
}

/**
 * The heads and the median, best and IQR rows of the section columns, over
 * the basis laps: the same numbers as the grid heads (selectionStats.ts), so
 * the two never disagree. Tow and traffic are flags, never exclusions.
 */
export function sectionTable(
  times: SegmentTimes | null,
  basis: ReadonlySet<string>,
  map?: TrackMapData | null,
): SectionTable | null {
  if (!times) return null;
  const stats = segmentBasisStats(times, basis);
  const corners = map ? trackCorners(map) : null;
  const row = (label: string, pick: (s: SegmentStats) => number | null) => ({
    label,
    cells: stats.map((s: SegmentStats) => {
      const v = pick(s);
      return v != null ? v.toFixed(2) : dash;
    }),
  });
  return {
    heads: times.segments.map(s => s.label),
    sections: times.segments.map(s => s.section ?? null),
    targets: times.segments.map(s => {
      const section =
        s.section == null
          ? undefined
          : map?.sections.find(x => x.n === s.section);
      return {
        corner:
          s.section != null && corners
            ? firstCornerOf(corners, s.section)
            : null,
        // A compound section (more than one corner) opens whole, read from the map.
        whole: section ? isCompound(section) : s.compound === true,
      };
    }),
    footer: [
      row('Median', s => s.medianS),
      row('Best', s => s.bestS),
      row('IQR', s => s.spreadS),
    ],
  };
}

/** "Rebuilt from the game file" and, on a tap, when and which stretches. */
export function rebuiltOf(
  session: Pick<SessionDetail, 'rebuilt'>,
): {line: string; detail: string} | null {
  const r = session.rebuilt;
  if (!r) return null;
  const n = (k: number, one: string, many: string) =>
    `${k} ${k === 1 ? one : many}`;
  return {
    line: 'Rebuilt from the game file',
    detail: [
      formatDayMonthTime(new Date(r.atMs).toISOString()),
      n(r.replaced, 'recording replaced', 'recordings replaced'),
      r.kept > 0 ? n(r.kept, 'stretch kept', 'stretches kept') : null,
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

export function buildSessionModel(
  session: SessionDetail,
  laps: Lap[],
  selection: Selection,
  /** The layout's map, for the corner windows; null while it loads or before the resync. */
  map: TrackMapData | null = null,
  /** Which segments the desktop table and the optimal lap read (Settings). */
  sectionMode: SectionMode = 'turns',
  /**
   * Set when the laps are a day (data/sessions/lapSet.ts): `session` is its
   * first member (it names the track and car) and `laps` the merged laps. The
   * set cards read the laps; the session cards (fuel, tyres, the field, Race,
   * the pit review) are not set facts and are left out.
   */
  day: DaySet | null = null,
): SessionScreenModel {
  // Every median, gap, bar and stint line, the head's Median included, is of
  // the basis laps (the ticked ones): one answer to "the median" on the screen
  // (decisions/lap/2026-10-11-selection-and-numbers.md). Best, Laps and
  // Comparable stay the session's facts.
  const basisLaps = basisOf(laps, new Set(selection.laps));
  const basis = new Set(basisLaps.map(l => l.id));
  const basisTimes = lapTimeStats(basisLaps);
  const median = basisTimes.medianS;
  const checked = selection.laps
    .map(id => laps.find(l => l.id === id))
    .filter((l): l is Lap => l != null);
  const slotOf = lapSlots(checked, selection.ref ?? null);
  const selIndexOf = (id: string) => slotOf.get(id) ?? null;
  const car = carLabel(session.car);
  const started = new Date(session.startedAt);

  // The game's sectors for the phone table; the desktop table reads the
  // segments the Settings toggle picks. Best = fastest among comparable laps.
  const sectorTimes = sectorSegmentTimes(laps);
  // A day cut at different corner windows has no section numbers at all: the
  // columns, optimum, spread and brake rows are lap times only (daySet.ts).
  const bySections = day == null || day.usesSections;
  const sectionTimes = bySections
    ? segmentTimesFor(sectionMode, laps, map)
    : null;
  const sectorCells = cellsOf(sectorTimes, basis, 1);
  const sectionCells = cellsOf(sectionTimes, basis, 2);
  const stintLines = new Map(
    stintNumbers(laps, basis, sectionTimes).map(s => [s.stint, s]),
  );

  const comparable = laps.filter(l => l.comparable);

  const chart: ChartModel | null =
    comparable.length === 0 || median == null
      ? null
      : {
          bars: laps.map(l => ({
            lapId: l.id,
            lapIndex: l.lapIndex,
            comparable: l.comparable,
            deltaS:
              l.comparable && l.timeS != null
                ? clamp(median - l.timeS, BAR_CLAMP_S)
                : 0,
            best: l.id === session.bestLapId,
            hollow: lapTraffic(l.traffic).hollow,
            selIndex: selIndexOf(l.id),
            highlighted: l.id === selection.hl,
          })),
          stintBreaks: laps
            .filter((l, i) => i > 0 && l.stint !== laps[i - 1].stint)
            .map(l => ({afterLap: l.lapIndex - 1, label: `STINT ${l.stint}`})),
          pits: laps.filter(l => l.pitIn).map(l => l.lapIndex),
          resets: laps.filter(l => l.endedInReset).map(l => l.lapIndex),
          rails: laps.some(l => l.traffic)
            ? {
                tow: laps
                  .filter(l => lapTraffic(l.traffic).towed)
                  .map(l => l.lapIndex),
                tick: laps
                  .filter(l => lapTraffic(l.traffic).tick)
                  .map(l => l.lapIndex),
                pit: laps.filter(l => l.pitIn || l.pitOut).map(l => l.lapIndex),
              }
            : null,
        };

  const noComparable =
    chart == null
      ? {
          title: `${laps.length} laps, none comparable`,
          reasons: laps.map(
            l =>
              `${lapLabel(l)}: ${statusFor(l, median, basisTimes.n).replace(
                'Excluded · ',
                '',
              )}`,
          ),
        }
      : null;

  // The best lap of the set: the session's own, or the fastest comparable lap
  // of a day (a day has no stored best).
  const bestLapId = day ? dayBestLapId(laps) : session.bestLapId;

  const rows: RowModel[] = [];
  const stintList: {n: number; sessionId?: string; startedAt?: string}[] = day
    ? day.stints
    : session.stints.length
    ? session.stints
    : [{n: 1}];
  const stintCount = stintList.length;
  for (const stint of stintList) {
    const stintLaps = laps.filter(l => l.stint === stint.n);
    if (stintLaps.length === 0) continue;
    const first = stintLaps[0].lapIndex;
    const last = stintLaps[stintLaps.length - 1].lapIndex;
    // A day names a stint by when its session began.
    const bits = [
      stint.startedAt ? formatClock(stint.startedAt) : `Stint ${stint.n}`,
      `L${first}–L${last}`,
    ];
    const line = stintLines.get(stint.n);
    if (line?.lapTimes.medianS != null) {
      bits.push(`med ${formatLapTime(line.lapTimes.medianS)}`);
      if (line.n > 1 && line.lapTimes.spreadS != null)
        bits.push(`IQR ${line.lapTimes.spreadS.toFixed(2)} s`);
      bits.push(`of ${line.n}`);
    }
    const split = stintTrafficText(stintLaps);
    rows.push({
      kind: 'stint',
      key: `stint-${stint.n}`,
      label: bits.join(' · ') + split,
      lapIds: stintLaps.filter(l => l.comparable).map(l => l.id),
      ...(stint.sessionId ? {sessionId: stint.sessionId} : {}),
    });
    const stintNote = day ? null : stintFuelLine(stintLaps);
    if (stintNote)
      rows.push({kind: 'note', key: `stint-${stint.n}-fuel`, text: stintNote});
    for (const l of stintLaps) {
      const gap =
        l.comparable && l.timeS != null && median != null
          ? l.timeS - median
          : null;
      rows.push({
        kind: 'lap',
        lapId: l.id,
        label: lapLabel(l),
        stint: l.stint,
        time: timeOrDash(l.timeS ?? l.invalidTimeS),
        gap: gap == null ? null : formatGap(gap),
        gapFaster: gap != null && gap < 0,
        sectors: sectorCells(l.id),
        sections: sectionCells(l.id),
        tags: tagsFor(l, bestLapId),
        comparable: l.comparable,
        selIndex: selIndexOf(l.id),
        highlighted: l.id === selection.hl,
      });
      const stopNote = !day && l.pitStop ? pitLine(l.pitStop) : null;
      if (stopNote)
        rows.push({
          kind: 'note',
          key: `${l.id}-pit`,
          text: stopNote,
          pitLapIndex: l.lapIndex,
        });
    }
  }

  const hlLap = laps.find(l => l.id === selection.hl) ?? null;
  const detail: DetailModel | null = hlLap && {
    lapId: hlLap.id,
    title: `${lapLabel(hlLap)} · ${timeOrDash(hlLap.timeS)}`,
    status: statusFor(hlLap, median, basisTimes.n),
    excluded: !hlLap.comparable,
    fuel: lapFuelLines(hlLap),
    traffic: trafficRows(hlLap.traffic),
    action: selIndexOf(hlLap.id) != null ? 'remove' : 'add',
  };

  const selected = checked;
  const stints = stintPicks(rows, selection.laps);
  // The tray stays while there are stints to pick, even with nothing selected.
  const tray: TrayModel | null =
    selected.length || stints.length
      ? {
          laps: selected.map(l => ({
            lapId: l.id,
            selIndex: slotOf.get(l.id) as number,
          })),
          count: selected.length,
          label:
            selected.length === 0
              ? ''
              : selected.length <= 3
              ? selected.map(lapLabel).join(' · ')
              : `${selected.length} laps`,
          stints,
        }
      : null;

  const bestLap = laps.find(l => l.id === bestLapId);
  const sections = sectionTable(sectionTimes, basis, map);
  const trafficPace = day ? [] : trafficPaceFacts(session, basisLaps);
  const pitCard = day ? null : buildPitCard(session.sessionType, laps, session);
  const fuelUse = day ? null : buildFuelUseCard(session, laps);
  return {
    trackId: session.trackId,
    sectorHeads: sectorTimes ? sectorTimes.segments.map(s => s.label) : [],
    strip: laps.map(l => ({
      id: l.id,
      timeS: l.timeS,
      stint: l.stint,
      comparable: l.comparable,
      pit: l.pitIn || l.pitOut,
    })),
    title: `${day ? 'Day · ' : ''}${
      TYPE_TITLE[session.sessionType]
    } · ${shortTrackName(session.track)}`,
    subtitle: [
      session.trackVariant || session.track,
      dayMonthOf(started) +
        ` ${String(started.getHours()).padStart(2, '0')}:${String(
          started.getMinutes(),
        ).padStart(2, '0')}`,
      car.model,
      car.entry,
      session.sim.toUpperCase(),
      day ? `${day.members.length} sessions` : modeText(session.online),
    ]
      .filter(Boolean)
      .join(' · '),
    facts: [
      {label: 'Laps', value: String(laps.length)},
      {label: 'Comparable', value: String(comparable.length)},
      {
        label: 'Best',
        value: timeOrDash(bestLap?.timeS ?? (day ? null : session.bestTimeS)),
        best: true,
        // A fact of the session: it can be a lap outside the selection.
        basis: 'session',
      },
      {
        label: 'Median',
        value: timeOrDash(median),
        basis: basisTimes.n > 0 ? `of ${basisTimes.n}` : undefined,
      },
      ...trafficPace,
    ],
    optimum: optimumFacts([...stintLines.values()], stintCount),
    optimumLines: optimumLines([...stintLines.values()], stintCount),
    sections,
    spread: spreadRows(sectionTimes, basis, sections),
    brake: brakeLedger(laps, basis, bySections ? map : null),
    chart,
    noComparable,
    rows,
    detail,
    tray,
    classTable: day
      ? null
      : classTable(session.classBests, bestLap?.timeS ?? session.bestTimeS),
    energy: day
      ? null
      : energyLine(
          session.sessionType,
          laps,
          pitCard ? 'pit' : fuelUse ? 'fuel' : null,
        ),
    pitCard,
    tires: day ? null : buildTiresCard(session, laps),
    rebuilt: day ? null : rebuiltOf(session),
    movedTo: day ? null : session.supersededBy ?? null,
    fuelUse,
    planVsRace: day ? null : raceFactsOfPlan(session, planKeyOf(session)),
  };
}

/** The laps the grid ticks when the URL names none: the set Compare opens on. */
export function useSessionOpeningLapIds(id: string): string[] {
  const session = useSession(id);
  const laps = useSessionLaps(id);
  return useMemo(() => {
    const s = session.data;
    if (!s || !laps.data) return [];
    return openingLapIds(laps.data, defaultSessionOf(s));
  }, [session.data, laps.data]);
}

/** The segment times the grid reads: the same sections the session table shows. */
export function useSessionSegmentTimes(id: string): SegmentTimes | null {
  const session = useSession(id);
  const laps = useSessionLaps(id);
  // The track's map, by track id (per-session map routes are gone, #432).
  const map = useTrackMap(session.data?.trackId);
  const sectionMode = useSectionMode();
  return useMemo(
    () =>
      laps.data
        ? segmentTimesFor(sectionMode, laps.data, map.data ?? null)
        : null,
    [laps.data, map.data, sectionMode],
  );
}

/** The screen model of a day (data/sessions/lapSet.ts); loading until it is ready. */
export function useDayScreenModel(set: DaySet | null, selection: Selection) {
  const map = useTrackMap(set?.members[0].trackId);
  const sectionMode = useSectionMode();
  return useMemo(
    () =>
      set
        ? {
            state: 'ready' as const,
            model: buildSessionModel(
              set.members[0],
              set.laps,
              selection,
              map.data ?? null,
              sectionMode,
              set,
            ),
          }
        : {state: 'loading' as const},
    [set, selection, map.data, sectionMode],
  );
}

/** The segment times of a day's merged laps: the same sections the session table shows. */
export function useDaySegmentTimes(day: DaySet | null): SegmentTimes | null {
  const map = useTrackMap(day?.members[0].trackId);
  const sectionMode = useSectionMode();
  return useMemo(
    () =>
      day?.usesSections
        ? segmentTimesFor(sectionMode, day.laps, map.data ?? null)
        : null,
    [day, map.data, sectionMode],
  );
}

export function useSessionScreenModel(id: string, selection: Selection) {
  const session = useSession(id);
  const laps = useSessionLaps(id);
  // Only the optimal lap needs the map; the screen draws without it.
  const map = useTrackMap(session.data?.trackId);
  const sectionMode = useSectionMode();
  return useMemo(() => {
    if (session.isError || laps.isError) {
      const error = session.error ?? laps.error;
      return {
        state: 'error' as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    if (!session.data || !laps.data) return {state: 'loading' as const};
    return {
      state: 'ready' as const,
      model: buildSessionModel(
        session.data,
        laps.data,
        selection,
        map.data ?? null,
        sectionMode,
      ),
    };
  }, [
    session.data,
    laps.data,
    map.data,
    session.error,
    laps.error,
    selection,
    sectionMode,
  ]);
}

/**
 * Where a grid cell (lap x column) opens Corner: the column's first corner, the
 * first part of a compound section. The tapped lap is the highlight, not added
 * to the set. Null where the column has no corner (the start straight). Pure:
 * the grid's taps and their tests read this one place.
 */
export function gridCellTargetOf(
  table: SectionTable,
  column: number,
  lapId: string,
  checked: string[],
): {corner: number; whole: boolean; laps: string[]} | null {
  const t = table.targets[column];
  if (!t || t.corner == null) return null;
  // The set is unchanged: the tapped lap is only highlighted.
  return {corner: t.corner, whole: t.whole, laps: checked};
}

/**
 * The stints the tray offers (D16/D17: pick a stint, compare, untick an
 * outlier, three taps): each stint header's comparable laps, when two or more
 * stints have any. A stint is active when the selection is exactly its laps,
 * in any order.
 */
export function stintPicks(rows: RowModel[], selected: string[]): StintPick[] {
  const picks = rows.flatMap(r =>
    r.kind === 'stint' && r.lapIds.length > 0 ? [r] : [],
  );
  if (picks.length < 2) return [];
  const chosen = new Set(selected);
  return picks.map(r => {
    const n = Number(r.key.slice('stint-'.length));
    return {
      n,
      label: String(n),
      lapIds: r.lapIds,
      active:
        r.lapIds.length === chosen.size && r.lapIds.every(id => chosen.has(id)),
    };
  });
}
