import {useMemo} from 'react';

import {
  type Lap,
  lapCornerTimes,
  type SessionDetail,
  trackCorners,
  useSession,
  useSessionLaps,
  useSessionMap,
} from '@/src/data/sessions';
import {formatDistance, formatGap, formatLapTime} from '@/src/design';

import {type Selection} from './model';

// Desktop-only panels of the Session workspace (handoff "Desktop", D1 right
// column): stints table, lap-time distribution, stint-vs-stint by corner.
// Pure; positions are fractions 0..1 so the component only scales them.

export type StintTableRow = {
  n: number;
  name: string;
  /** "13/17": comparable / total laps. */
  count: string;
  median: string;
  best: string;
  /** Standard deviation of comparable lap times, "0.91". */
  spread: string;
  /** "L1–L17 · fall-off +0.042 s/lap"; the trend part only when stored. */
  detail: string;
};

export type DistributionDot = {
  lapId: string;
  row: number;
  /** 0 = fastest lap on the axis, 1 = slowest. */
  x01: number;
  selIndex: number | null;
  best: boolean;
  highlighted: boolean;
};

export type DistributionModel = {
  rows: {n: number; label: string; median01: number | null}[];
  dots: DistributionDot[];
  axis: {x01: number; label: string}[];
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
  explainer: string;
  rows: StintCornerRow[];
  total: string;
};

export type CornerRef = {n: number; apexM: number};

const dash = '—';

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function comparableTimes(laps: Lap[]): number[] {
  const out: number[] = [];
  for (const l of laps) if (l.comparable && l.timeS != null) out.push(l.timeS);
  return out;
}

export function buildStintTable(
  session: SessionDetail,
  laps: Lap[],
): StintTableRow[] {
  const rows: StintTableRow[] = [];
  for (const s of session.stints) {
    const stintLaps = laps.filter(l => l.stint === s.n);
    if (stintLaps.length === 0) continue;
    const first = stintLaps[0].lapIndex;
    const last = stintLaps[stintLaps.length - 1].lapIndex;
    const detail = [`L${first}–L${last}`];
    if (s.trendSPerLap != null)
      detail.push(`fall-off ${formatGap(s.trendSPerLap)} s/lap`);
    rows.push({
      n: s.n,
      name: `Stint ${s.n}`,
      count: `${s.comparableCount}/${s.lapCount}`,
      median: s.medianTimeS == null ? dash : formatLapTime(s.medianTimeS),
      best: s.bestTimeS == null ? dash : formatLapTime(s.bestTimeS),
      spread: s.stdevS == null ? dash : s.stdevS.toFixed(2),
      detail: detail.join(' · '),
    });
  }
  return rows;
}

/** One row per stint with comparable laps; one dot per comparable lap. */
export function buildDistribution(
  session: SessionDetail,
  laps: Lap[],
  selection: Selection,
): DistributionModel | null {
  const all = comparableTimes(laps);
  if (all.length === 0) return null;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const x01 = (t: number) => (t - lo) / span;

  const stintNs = [...new Set(laps.map(l => l.stint))].sort((a, b) => a - b);
  const rows: DistributionModel['rows'] = [];
  const dots: DistributionDot[] = [];
  for (const n of stintNs) {
    const stintLaps = laps.filter(
      l => l.stint === n && l.comparable && l.timeS != null,
    );
    if (stintLaps.length === 0) continue;
    const row = rows.length;
    const med = median(comparableTimes(stintLaps));
    rows.push({
      n,
      label: `Stint ${n}`,
      median01: med == null ? null : x01(med),
    });
    for (const l of stintLaps) {
      const i = selection.laps.indexOf(l.id);
      dots.push({
        lapId: l.id,
        row,
        x01: x01(l.timeS as number),
        selIndex: i < 0 ? null : i,
        best: l.id === session.bestLapId,
        highlighted: l.id === selection.hl,
      });
    }
  }
  const axis = [lo, (lo + hi) / 2, hi].map(t => ({
    x01: x01(t),
    label: formatLapTime(t),
  }));
  return {rows, dots, axis};
}

/**
 * Median segment time per corner for the second stint minus the first,
 * comparable laps only. Null unless two stints both have comparable laps
 * with corner times.
 */
export function buildStintVsStint(
  laps: Lap[],
  corners: CornerRef[] | null,
): StintVsStintModel | null {
  const stintNs = [...new Set(laps.map(l => l.stint))].sort((a, b) => a - b);
  const byStint = stintNs
    .map(n => ({
      n,
      times: laps
        .filter(l => l.stint === n && l.comparable)
        .map(lapCornerTimes)
        .filter(t => t.length > 0),
    }))
    .filter(s => s.times.length > 0);
  if (byStint.length < 2) return null;
  const [a, b] = byStint;

  const count = Math.min(...[...a.times, ...b.times].map(t => t.length));
  const medianAt = (times: (number | null)[][], i: number) =>
    median(times.map(t => t[i]).filter((v): v is number => v != null));

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
    explainer: `Median segment time per corner over comparable laps, stint ${b.n} minus stint ${a.n}, in seconds. Left and green = stint ${b.n} faster; right and red = slower.`,
    rows: raw.map(r => ({
      key: String(r.i),
      label: `C${named ? named[r.i].n : r.i + 1}`,
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
  distribution: DistributionModel | null;
  stintVsStint: StintVsStintModel | null;
};

/** Gathers inputs for the desktop panels; the queries are shared with the screen. */
export function useSessionDesktopModel(
  id: string,
  selection: Selection,
): SessionDesktopModel | null {
  const session = useSession(id);
  const laps = useSessionLaps(id);
  const map = useSessionMap(id);
  return useMemo(() => {
    if (!session.data || !laps.data) return null;
    // Corner numbers are the map's parts (C1–C11), in lapCornerTimes order.
    const corners = map.data ? trackCorners(map.data) : null;
    return {
      stints: buildStintTable(session.data, laps.data),
      distribution: buildDistribution(session.data, laps.data, selection),
      stintVsStint: buildStintVsStint(laps.data, corners),
    };
  }, [session.data, laps.data, map.data, selection]);
}
