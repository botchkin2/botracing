import {useMemo} from 'react';

import {
  type Lap,
  type SessionDetail,
  useSession,
  useSessionLaps,
} from '@/src/data/sessions';
import {carLabel, formatGap, formatLapTime, shortTrackName} from '@/src/design';

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
  selIndex: number | null;
  highlighted: boolean;
};

export type ChartModel = {
  bars: Bar[];
  /** The one-line explainer under the chart label (handoff copy). */
  explainer: string;
  /** Lap index after which a new stint starts. */
  stintBreaks: {afterLap: number; label: string}[];
  /** Lap index of each pit-in lap. */
  pits: number[];
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

export type RowModel = LapRowModel | StintRowModel;

export type DetailModel = {
  lapId: string;
  title: string;
  status: string;
  excluded: boolean;
  why: string | null;
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
  chart: ChartModel | null;
  noComparable: {title: string; reasons: string[]} | null;
  rows: RowModel[];
  detail: DetailModel | null;
  tray: TrayModel | null;
};

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
  if (lap.partial || lap.reasons.includes('untimed')) tags.push({code: 'PART'});
  if (lap.reasons.includes('slow')) tags.push({code: 'SLOW'});
  if (lap.offTrackS >= OFF_TRACK_TOLERANCE_S)
    tags.push({code: `OFF ${lap.offTrackS.toFixed(1)}`});
  if (lap.hadImpact) tags.push({code: 'HIT'});
  return tags;
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
          explainer: `Each bar is one lap. Up = faster than the median (${formatLapTime(
            median,
          )}), down = slower; bars stop at ±${BAR_CLAMP_S.toFixed(
            1,
          )} s. Outlined stubs at the bottom are excluded laps. Tap a bar to find it in the table.`,
          bars: laps.map(l => ({
            lapId: l.id,
            lapIndex: l.lapIndex,
            comparable: l.comparable,
            deltaS:
              l.comparable && l.timeS != null
                ? clamp(median - l.timeS, BAR_CLAMP_S)
                : 0,
            best: l.id === session.bestLapId,
            selIndex: selIndexOf(l.id),
            highlighted: l.id === selection.hl,
          })),
          stintBreaks: laps
            .filter((l, i) => i > 0 && l.stint !== laps[i - 1].stint)
            .map(l => ({afterLap: l.lapIndex - 1, label: `STINT ${l.stint}`})),
          pits: laps.filter(l => l.pitIn).map(l => l.lapIndex),
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
    rows.push({
      kind: 'stint',
      key: `stint-${stint.n}`,
      label: bits.join(' · '),
      lapIds: stintLaps.filter(l => l.comparable).map(l => l.id),
    });
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
    }
  }

  const hlLap = laps.find(l => l.id === selection.hl) ?? null;
  const detail: DetailModel | null = hlLap && {
    lapId: hlLap.id,
    title: `${lapLabel(hlLap)} · ${timeOrDash(hlLap.timeS)}`,
    status: statusFor(hlLap, median),
    excluded: !hlLap.comparable,
    why: reasonText(hlLap, stintMedian.get(hlLap.stint) ?? null) || null,
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
    ],
    chart,
    noComparable,
    rows,
    detail,
    tray,
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
