// The Tires card's "Lap time and wear" panels (round 7 1A, pit-wall thread 44):
// the laps from analysis/tyreWear.ts as scatter inputs. Same axes on every
// band so the panels read against each other. Pure.
import {isCleanTraffic} from '@/src/analysis/traffic';
import {type WearBand, type WearLap, wearBands} from '@/src/analysis/tyreWear';
import type {Lap} from '@/src/data/sessions';
import {formatLapTime} from '@/src/design';

import {WHEELS} from '@/src/analysis/tyres';

export type WearPanel = {
  label: string;
  points: {key: string; x: number; y: number}[];
  fit: {x1: number; y1: number; x2: number; y2: number} | null;
  /** "+0.12 s per 1 % lost · 9 laps", or why there is no line. */
  note: string;
};

export type WearScatterModel = {
  panels: WearPanel[];
  xDomain: [number, number];
  yDomain: [number, number];
  xTicks: {v: number; label: string}[];
  yTicks: {v: number; label: string}[];
  /** True when the laps were limited to clean ones (the session has a field). */
  cleanOnly: boolean;
  n: number;
};

/** Fewest laps for the panels at all. */
export const MIN_SCATTER_LAPS = 5;

const hasDeadWheel = (l: Lap) => {
  const p = l.tyres?.pressureKpa;
  if (!p) return false;
  const reads = WHEELS.filter(w => p[w] != null).length;
  return reads > 0 && reads < WHEELS.length;
};

const forClean = (t: NonNullable<Lap['traffic']>) => ({
  ...t,
  overtakes: {length: t.overtakes},
});

/** Clean green laps with all four wheels reading wear and a fuel level at the start. */
export function wearLaps(laps: Lap[], hasField: boolean): WearLap[] {
  const out: WearLap[] = [];
  for (const l of laps) {
    const wear = l.tyres?.wearPct;
    const startL = l.fuel?.startL;
    if (!wear || startL == null || l.timeS == null || !l.comparable) continue;
    if (l.fuel?.green !== true || hasDeadWheel(l)) continue;
    // With a field a clean lap is free air; without one nothing can be said, so every green lap counts.
    if (hasField && !(l.traffic && isCleanTraffic(forClean(l.traffic))))
      continue;
    const vals = WHEELS.map(w => wear[w]);
    if (vals.some(v => v == null)) continue;
    const mean = (vals as number[]).reduce((a, b) => a + b, 0) / vals.length;
    out.push({
      lapId: l.id,
      timeS: l.timeS,
      lostPct: Math.max(0, 100 - mean),
      fuelStartL: startL,
    });
  }
  return out;
}

function noteOf(b: WearBand): string {
  if (b.empty === 'few-laps')
    return `${b.laps.length} laps: too few for a line (5 needed).`;
  if (b.empty === 'one-set')
    return `${b.laps.length} laps, but all on about the same wear: a line needs tyres run across two stints.`;
  const s = b.slopeSPerPct ?? 0;
  return `${s >= 0 ? '+' : '−'}${Math.abs(s).toFixed(3)} s per 1 % lost · ${
    b.laps.length
  } laps`;
}

function padded([lo, hi]: [number, number]): [number, number] {
  const span = Math.max(hi - lo, 0.5);
  return [lo - span * 0.1, hi + span * 0.1];
}

/** Null under MIN_SCATTER_LAPS laps. */
export function buildWearScatter(
  laps: Lap[],
  hasField: boolean,
): WearScatterModel | null {
  const pts = wearLaps(laps, hasField);
  if (pts.length < MIN_SCATTER_LAPS) return null;
  const bands = wearBands(pts);
  const xs = pts.map(p => p.lostPct);
  const ys = pts.map(p => p.timeS);
  const xDomain: [number, number] = [
    0,
    Math.max(5, Math.ceil(Math.max(...xs))),
  ];
  const yDomain = padded([Math.min(...ys), Math.max(...ys)]);
  const ticks = ([lo, hi]: [number, number], label: (v: number) => string) =>
    [0, 1, 2].map(i => {
      const v = lo + ((hi - lo) * i) / 2;
      return {v, label: label(v)};
    });
  return {
    panels: bands.map(b => ({
      label: b.label,
      points: b.laps.map(l => ({key: l.lapId, x: l.lostPct, y: l.timeS})),
      fit: b.line,
      note: noteOf(b),
    })),
    xDomain,
    yDomain,
    xTicks: ticks(xDomain, v => `${v.toFixed(0)} %`),
    yTicks: ticks(yDomain, formatLapTime),
    cleanOnly: hasField,
    n: pts.length,
  };
}

export const WEAR_SCATTER_KEY =
  'Clean green laps, whole race. Right = more worn (mean of four wheels), up = faster. Split by fuel at the start of the lap so the fuel effect is not counted as wear. Dashed = least-squares fit. It shows the two move together, not that one causes the other. Track changes over the race are not separated.';
