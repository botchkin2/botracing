import {useMemo} from 'react';

import type {RaceFacts} from '@/src/analysis/fuelPlan';

import {
  raceFacts,
  type Lap,
  type SessionDetail,
  useSession,
  useSessionLaps,
} from '@/src/data/sessions';
import {carLabel, formatGap, formatLapTime, shortTrackName} from '@/src/design';
import {planComboKey} from '@/src/nav/routes';

import {lapFuelLines, pitLine, stintFuelLine} from './fuelLines';
import {buildFuelUse, type FuelUse} from './fuelUse';
import {buildPitCard, type PitCard} from './pitCard';
import {buildTiresCard, type TiresCard} from './tireCard';
import {buildWearScatter, type WearScatterModel} from './wearScatter';
import {bestWithoutTow, lapTraffic, orderTags, trafficTags} from './lapTags';
import {
  PACE_RULE,
  setText,
  stintTrafficText,
  type TrafficRow,
  trafficRows,
} from './trafficFacts';

// Session screen view model (handoff §2). buildSessionModel is pure: session,
// laps and the URL selection in, everything the screen draws out. Colors are
// not decided here; `selIndex` (0 = reference) picks the lap color.

export type Selection = {
  /** Lap ids in selection order; the first is the reference. */
  laps: string[];
  /** The highlighted (tapped) lap. */
  hl: string | null;
};

export type Fact = {label: string; value: string; best?: boolean};

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
  sectors: {value: string; best: boolean}[];
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
  why: string | null;
  /** Fuel and Virtual Energy on the lap, one line each (fuelLines.ts). */
  fuel: string[];
  /** Seconds and counts from the field; null on a lap without one (round 7, 2B). */
  traffic: TrafficRow[] | null;
  action: 'add' | 'remove' | 'reference';
};

export type TrayModel = {
  laps: {lapId: string; selIndex: number}[];
  label: string;
  count: number;
};

export type SessionScreenModel = {
  title: string;
  subtitle: string;
  /** For the link to the layout's Track page. */
  trackId: string;
  facts: Fact[];
  /** What "clean" and "traffic" mean, when either is shown; null otherwise. */
  paceRule: string | null;
  chart: ChartModel | null;
  noComparable: {title: string; reasons: string[]} | null;
  rows: RowModel[];
  detail: DetailModel | null;
  tray: TrayModel | null;
  /** Races with a stop only. */
  pitCard: PitCard | null;
  /** Per-wheel wear, pressure and rubber temperature by stint. */
  tires: TiresCard;
  /** Lap time against wear, by fuel band; null under 10 green laps. */
  wearScatter: WearScatterModel | null;
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
  return planComboKey(session.trackId, carLabel(session.car).model);
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
 * The clean and traffic medians beside the overall median, never instead of
 * it (Botkin, pit-wall thread 44 #1563): the headline pace stays every
 * comparable lap. Each shows the laps it uses and is left out under the 3-lap
 * floor or before a field's traffic block is analysed. A session with no
 * field says so, once.
 */
export function trafficPaceFacts(session: SessionDetail): Fact[] {
  const {traffic, field} = session;
  if (traffic == null)
    return field == null
      ? [{label: 'Clean median', value: 'No other cars recorded'}]
      : [];
  const facts: Fact[] = [];
  for (const [label, set] of [
    ['Clean median', traffic.clean],
    ['Traffic median', traffic.traffic],
  ] as const) {
    const value = setText(set, session.comparableCount);
    if (value) facts.push({label, value});
  }
  return facts;
}

export const BAR_CLAMP_S = 1.5;

const TYPE_TITLE = {R: 'Race', Q: 'Qualifying', P: 'Practice'} as const;
const lapLabel = (lap: Lap) => `L${lap.lapIndex}`;
const timeOrDash = (t: number | null) => (t == null ? '—' : formatLapTime(t));
const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));

function tagsFor(lap: Lap, bestLapId: string | null): Tag[] {
  const tags: Tag[] = [];
  if (lap.id === bestLapId) tags.push({code: 'BEST', best: true});
  if (lap.pitOut) tags.push({code: 'OUT'});
  if (lap.pitIn) tags.push({code: 'IN'});
  // A lap cut short by a reset says so, instead of the generic PART.
  if (lap.endedInReset) tags.push({code: 'RESET'});
  else if (lap.partialWhy === 'grid') tags.push({code: 'PARK'});
  else if (lap.partial || lap.reasons.includes('untimed'))
    tags.push({code: 'PART'});
  if (lap.reasons.includes('slow')) tags.push({code: 'SLOW'});
  if (lap.offTrackS >= OFF_TRACK_TOLERANCE_S)
    tags.push({code: `OFF ${lap.offTrackS.toFixed(1)}`});
  if (lap.hadImpact) tags.push({code: 'HIT'});
  tags.push(...trafficTags(lap.traffic));
  return orderTags(tags);
}

/** Off-track time a comparable lap may carry (handoff exclusion copy). */
export const OFF_TRACK_TOLERANCE_S = 1.0;

/** The one-sentence reason in the detail panel (handoff "Exclusion reason copy"). */
export function reasonText(lap: Lap, stintMedianS: number | null): string {
  const parts: string[] = [];
  if (lap.pitOut)
    parts.push('Starts in the pit lane, so it includes pit exit time.');
  else if (lap.pitIn)
    parts.push('Ends in the pit lane, so it includes pit entry time.');
  else if (lap.endedInReset)
    parts.push('Ends in a reset to the garage, so the lap is incomplete.');
  else if (lap.partialWhy === 'grid')
    parts.push(
      'Starts parked (the grid or the garage), so this is the roll to the line, not a lap.',
    );
  else if (lap.partial || lap.reasons.includes('untimed'))
    parts.push('Timing started partway round, so the lap is incomplete.');
  else if (lap.reasons.includes('slow') && lap.timeS != null && stintMedianS)
    parts.push(
      `${formatGap(
        lap.timeS - stintMedianS,
        2,
      )} s vs the stint median, so it is excluded as a slow outlier.`,
    );
  if (lap.offTrackS >= 0.1) {
    const off = `Off track for ${lap.offTrackS.toFixed(1)} s`;
    parts.push(
      lap.comparable && lap.offTrackS < OFF_TRACK_TOLERANCE_S
        ? `${off}, under the ${OFF_TRACK_TOLERANCE_S.toFixed(
            1,
          )} s tolerance, so the lap still counts.`
        : `${off}.`,
    );
  }
  if (lap.hadImpact) parts.push('Impact detected, possible damage.');
  return parts.join(' ');
}

function statusFor(lap: Lap, medianS: number | null): string {
  if (!lap.comparable) {
    const why = lap.pitOut
      ? 'Pit out'
      : lap.pitIn
      ? 'Pit in'
      : lap.endedInReset
      ? 'Reset'
      : lap.partialWhy === 'grid'
      ? 'Parked start'
      : lap.partial || lap.reasons.includes('untimed')
      ? 'Partial'
      : lap.reasons.includes('slow')
      ? 'Slow outlier'
      : 'Not comparable';
    return `Excluded · ${why}`;
  }
  if (lap.timeS == null || medianS == null) return 'Comparable';
  return `Comparable · ${formatGap(lap.timeS - medianS)} s vs median`;
}

export function buildSessionModel(
  session: SessionDetail,
  laps: Lap[],
  selection: Selection,
): SessionScreenModel {
  const median = session.medianTimeS;
  const selIndexOf = (id: string) => {
    const i = selection.laps.indexOf(id);
    return i < 0 ? null : i;
  };
  const stintMedian = new Map(session.stints.map(s => [s.n, s.medianTimeS]));
  const car = carLabel(session.car);
  const started = new Date(session.startedAt);

  // Best sector = fastest value among comparable laps.
  const sectorCount = Math.max(0, ...laps.map(l => l.sectorsS.length));
  const bestSectors = Array.from({length: sectorCount}, (_, i) =>
    Math.min(
      ...laps
        .filter(l => l.comparable && l.sectorsS[i] != null)
        .map(l => l.sectorsS[i] as number),
    ),
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
              `${lapLabel(l)}: ${statusFor(l, median).replace(
                'Excluded · ',
                '',
              )}`,
          ),
        }
      : null;

  const rows: RowModel[] = [];
  for (const stint of session.stints.length
    ? session.stints
    : [{n: 1} as SessionDetail['stints'][number]]) {
    const stintLaps = laps.filter(l => l.stint === stint.n);
    if (stintLaps.length === 0) continue;
    const first = stintLaps[0].lapIndex;
    const last = stintLaps[stintLaps.length - 1].lapIndex;
    const bits = [`Stint ${stint.n}`, `L${first}–L${last}`];
    if (stint.medianTimeS != null)
      bits.push(`med ${formatLapTime(stint.medianTimeS)}`);
    if (stint.stdevS != null) bits.push(`± ${stint.stdevS.toFixed(2)} s`);
    const split = stintTrafficText(stintLaps);
    rows.push({
      kind: 'stint',
      key: `stint-${stint.n}`,
      label: bits.join(' · ') + split,
      lapIds: stintLaps.filter(l => l.comparable).map(l => l.id),
    });
    const stintNote = stintFuelLine(stint);
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
        time: timeOrDash(l.timeS),
        gap: gap == null ? null : formatGap(gap),
        gapFaster: gap != null && gap < 0,
        sectors: Array.from({length: sectorCount}, (_, i) => {
          const v = l.sectorsS[i];
          return {
            value: v == null ? '—' : v.toFixed(1),
            best: l.comparable && v != null && v === bestSectors[i],
          };
        }),
        tags: tagsFor(l, session.bestLapId),
        comparable: l.comparable,
        selIndex: selIndexOf(l.id),
        highlighted: l.id === selection.hl,
      });
      const stopNote = l.pitStop ? pitLine(l.pitStop) : null;
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
    status: statusFor(hlLap, median),
    excluded: !hlLap.comparable,
    why: reasonText(hlLap, stintMedian.get(hlLap.stint) ?? null) || null,
    fuel: lapFuelLines(hlLap),
    traffic: trafficRows(hlLap.traffic),
    action:
      selIndexOf(hlLap.id) === 0
        ? 'reference'
        : selIndexOf(hlLap.id) != null
        ? 'remove'
        : 'add',
  };

  const selected = selection.laps
    .map(id => laps.find(l => l.id === id))
    .filter((l): l is Lap => l != null);
  const tray: TrayModel | null = selected.length
    ? {
        laps: selected.map((l, i) => ({lapId: l.id, selIndex: i})),
        count: selected.length,
        label:
          selected.length <= 3
            ? selected.map(lapLabel).join(' · ')
            : `${lapLabel(selected[0])} ref + ${selected.length - 1} laps`,
      }
    : null;

  const bestLap = laps.find(l => l.id === session.bestLapId);
  const clean = bestWithoutTow(laps, session.bestLapId);
  const trafficPace = trafficPaceFacts(session);
  const cleanBestFact: Fact[] = clean
    ? [
        {
          label: 'Best without TOW or TRAF',
          value: `${lapLabel(clean.lap)} ${timeOrDash(
            clean.lap.timeS,
          )} · ${formatGap(clean.behindS, 3)} s`,
        },
      ]
    : [];
  return {
    trackId: session.trackId,
    title: `${TYPE_TITLE[session.sessionType]} · ${shortTrackName(
      session.track,
    )}`,
    subtitle: [
      session.trackVariant || session.track,
      started.toLocaleDateString('en-GB', {day: 'numeric', month: 'short'}) +
        ` ${String(started.getHours()).padStart(2, '0')}:${String(
          started.getMinutes(),
        ).padStart(2, '0')}`,
      car.model,
      car.entry,
      session.sim.toUpperCase(),
    ]
      .filter(Boolean)
      .join(' · '),
    facts: [
      {label: 'Laps', value: String(laps.length)},
      {label: 'Comparable', value: String(comparable.length)},
      {
        label: 'Best',
        value: timeOrDash(bestLap?.timeS ?? session.bestTimeS),
        best: true,
      },
      {label: 'Median', value: timeOrDash(median)},
      ...trafficPace,
      ...cleanBestFact,
    ],
    paceRule: session.traffic && trafficPace.length > 0 ? PACE_RULE : null,
    chart,
    noComparable,
    rows,
    detail,
    tray,
    pitCard: buildPitCard(session.sessionType, laps, session),
    tires: buildTiresCard(session, laps),
    wearScatter: buildWearScatter(laps),
    fuelUse: buildFuelUseCard(session, laps),
    planVsRace: raceFacts(session, planKeyOf(session), laps),
  };
}

// --- selection edits (pure; the screen writes the result to the URL) --------

export function toggleLap(sel: Selection, lapId: string): Selection {
  const i = sel.laps.indexOf(lapId);
  if (i === 0) return sel; // the reference is not removed from here
  return {
    ...sel,
    laps: i < 0 ? [...sel.laps, lapId] : sel.laps.filter(id => id !== lapId),
  };
}

export function selectStint(sel: Selection, lapIds: string[]): Selection {
  const rest = lapIds.filter(id => !sel.laps.includes(id));
  return {...sel, laps: [...sel.laps, ...rest]};
}

export function useSessionScreenModel(id: string, selection: Selection) {
  const session = useSession(id);
  const laps = useSessionLaps(id);
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
      model: buildSessionModel(session.data, laps.data, selection),
    };
  }, [session.data, laps.data, session.error, laps.error, selection]);
}
