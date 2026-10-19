import {basisOf} from '@/src/analysis/lapBasis';
import {useMemo} from 'react';

import {columnStats} from '@/src/analysis/segments';
import {
  type DaySet,
  type Lap,
  lapCornerTimes,
  type SessionDetail,
  trackCorners,
  useSession,
  useSessionLaps,
  useTrackMap,
} from '@/src/data/sessions';
import {
  formatClock,
  formatDistance,
  formatGap,
  formatLapTime,
  turnLabel,
} from '@/src/design';

import {type Selection} from './model';
import {lapTimeStats} from './selectionStats';

// Desktop-only panels of the Session workspace (handoff "Desktop", D1 right
// column): stints table and stint-vs-stint by corner.
// Pure; positions are fractions 0..1 so the component only scales them.

export type StintTableRow = {
  n: number;
  name: string;
  /** "13/17": the stint's basis (ticked) laps / all its laps. */
  count: string;
  median: string;
  best: string;
  /** IQR (p75 - p25) of the basis laps' times, "0.31": the one spread the app shows. */
  spread: string;
  /** "L1–L17". The fall-off trend is not shown (triage #20). */
  detail: string;
};

export type StintCornerRow = {
  key: string;
  label: string;
  /** Apex distance, "1,240 m", when the track map is known. */
  dist: string | null;
  /** Later stint minus earlier stint, median segment time. Negative = faster. */
  deltaS: number;
  /** |deltaS| over the largest |deltaS| in the panel, 0..1. */
  frac: number;
  value: string;
};

export type StintVsStintModel = {
  title: string;
  rows: StintCornerRow[];
  total: string;
};

export type CornerRef = {n: number; official?: string; apexM: number};

const dash = '—';

/**
 * One row per stint, over the stint's basis laps (the ticked ones, or the
 * comparable ones with none ticked): the same median and IQR as the stint
 * line in the lap table (selectionStats.ts).
 */
export function buildStintTable(
  session: {stints: readonly {n: number; startedAt?: string}[]},
  laps: Lap[],
  ticked: ReadonlySet<string>,
): StintTableRow[] {
  const basis = new Set(basisOf(laps, ticked).map(l => l.id));
  const rows: StintTableRow[] = [];
  for (const s of session.stints) {
    const stintLaps = laps.filter(l => l.stint === s.n);
    if (stintLaps.length === 0) continue;
    const first = stintLaps[0].lapIndex;
    const last = stintLaps[stintLaps.length - 1].lapIndex;
    const picked = stintLaps.filter(l => basis.has(l.id));
    const stats = lapTimeStats(picked);
    rows.push({
      n: s.n,
      // A day names a stint by when its session began.
      name: s.startedAt ? formatClock(s.startedAt) : `Stint ${s.n}`,
      count: `${picked.length}/${stintLaps.length}`,
      median: stats.medianS == null ? dash : formatLapTime(stats.medianS),
      best: stats.bestS == null ? dash : formatLapTime(stats.bestS),
      spread:
        stats.n > 1 && stats.spreadS != null ? stats.spreadS.toFixed(2) : dash,
      detail: `L${first}–L${last}`,
    });
  }
  return rows;
}

/**
 * Median segment time per corner for the second stint minus the first, over
 * the basis laps. Null unless two stints both have basis laps with corner
 * times.
 */
export function buildStintVsStint(
  laps: Lap[],
  corners: CornerRef[] | null,
  ticked: ReadonlySet<string> = new Set(),
): StintVsStintModel | null {
  const basis = new Set(basisOf(laps, ticked).map(l => l.id));
  const stintNs = [...new Set(laps.map(l => l.stint))].sort((a, b) => a - b);
  const byStint = stintNs
    .map(n => ({
      n,
      times: laps
        .filter(l => l.stint === n && basis.has(l.id))
        .map(lapCornerTimes)
        .filter(t => t.length > 0),
    }))
    .filter(s => s.times.length > 0);
  if (byStint.length < 2) return null;
  const [a, b] = byStint;

  const count = Math.min(...[...a.times, ...b.times].map(t => t.length));
  const medianAt = (times: (number | null)[][], i: number) =>
    columnStats(times.map(t => t[i])).medianS;

  const raw: {i: number; deltaS: number}[] = [];
  for (let i = 0; i < count; i++) {
    const ma = medianAt(a.times, i);
    const mb = medianAt(b.times, i);
    if (ma != null && mb != null) raw.push({i, deltaS: mb - ma});
  }
  if (raw.length === 0) return null;
  const maxAbs = Math.max(...raw.map(r => Math.abs(r.deltaS))) || 1;
  // Corner numbers come from the track map when it has the same corner count.
  const named = corners && corners.length === count ? corners : null;
  const total = raw.reduce((sum, r) => sum + r.deltaS, 0);
  return {
    title: `Stint ${b.n} vs Stint ${a.n}`,
    rows: raw.map(r => ({
      key: String(r.i),
      label: named
        ? turnLabel(named[r.i].n, named[r.i].official)
        : turnLabel(r.i + 1),
      dist: named ? formatDistance(named[r.i].apexM) : null,
      deltaS: r.deltaS,
      frac: Math.abs(r.deltaS) / maxAbs,
      value: formatGap(r.deltaS),
    })),
    total: formatGap(total),
  };
}

export type SessionDesktopModel = {
  stints: StintTableRow[];
  stintVsStint: StintVsStintModel | null;
};

/** Gathers inputs for the desktop panels; the queries are shared with the screen. */
export function useSessionDesktopModel(
  id: string,
  selection: Selection,
  day: DaySet | null = null,
): SessionDesktopModel | null {
  const own = useSession(id);
  const ownLaps = useSessionLaps(id);
  const map = useTrackMap(day ? day.trackId : own.data?.trackId);
  const ownSession = own.data;
  const ownLapData = ownLaps.data;
  return useMemo(() => {
    const session = day ? {stints: day.stints} : ownSession;
    const laps = day ? day.laps : ownLapData;
    if (!session || !laps) return null;
    // Corner numbers are the map's parts (T1–T11), in lapCornerTimes order. A
    // day cut at different windows has none: lap times only (daySet.ts).
    const corners =
      map.data && (day?.usesSections ?? true) ? trackCorners(map.data) : null;
    const ticked = new Set(selection.laps);
    return {
      stints: buildStintTable(session, laps, ticked),
      stintVsStint: buildStintVsStint(laps, corners, ticked),
    };
  }, [day, ownSession, ownLapData, map.data, selection]);
}
