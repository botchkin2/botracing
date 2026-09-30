import {type DropStop, type GreenLap} from '@/src/analysis/fuelPlan';
import {formatLapTime} from '@/src/design';

// "Use and lap time" (round 5, item 4): every green lap at this track and car
// as one dot, use per lap across and lap time up. This session's laps are at
// full ink and earlier sessions are muted. The one reference line is the
// plan's "to drop a stop" use per lap. Pure: the card gathers the laps through
// the Plan screen's own hooks.

export type UseMeasure = 'fuel' | 've';

export type PooledUse = {
  points: {
    key: string;
    x: number;
    y: number;
    hollow: boolean;
    muted: boolean;
  }[];
  xDomain: [number, number];
  /** Lap time, seconds; the chart draws faster at the top. */
  yDomain: [number, number];
  xTicks: {v: number; label: string}[];
  yTicks: {v: number; label: string}[];
  /** The plan's use per lap to drop a stop, when it lies on this measure. */
  threshold: {x: number; label: string} | null;
  /** Laps drawn, and how many of them are from this session. */
  n: number;
  thisSession: number;
};

const MIN_X_SPAN: Record<UseMeasure, number> = {fuel: 0.1, ve: 0.2};

/** A range widened a tenth each side and at least `minSpan` wide, so one value still has a frame. */
function padded(values: number[], minSpan: number): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(hi - lo, minSpan);
  const mid = (lo + hi) / 2;
  return [mid - span * 0.6, mid + span * 0.6];
}

function ticksOf(
  [lo, hi]: [number, number],
  label: (v: number) => string,
): {v: number; label: string}[] {
  return [0, 1, 2].map(i => {
    const v = lo + ((hi - lo) * i) / 2;
    return {v, label: label(v)};
  });
}

/** The plan's use per lap to reach with one stop fewer, for this measure; null when the plan has none. */
export function thresholdOf(
  drop: DropStop | null,
  measure: UseMeasure,
): {x: number; label: string} | null {
  if (!drop) return null;
  if (measure === 'fuel')
    return drop.fuelPerLapL == null
      ? null
      : {
          x: drop.fuelPerLapL,
          label: `${drop.fuelPerLapL.toFixed(2)} L to drop a stop`,
        };
  return drop.vePerLapPct == null
    ? null
    : {
        x: drop.vePerLapPct,
        label: `${drop.vePerLapPct.toFixed(1)} % to drop a stop`,
      };
}

/** Null without a lap that has this measure (VE is left out, never drawn at 0). */
export function pooledUse(
  laps: GreenLap[],
  sessionId: string,
  measure: UseMeasure,
  threshold: {x: number; label: string} | null,
): PooledUse | null {
  const use = (l: GreenLap) => (measure === 'fuel' ? l.fuelL : l.vePct);
  const drawn = laps.flatMap((l, i) => {
    const x = use(l);
    return x == null
      ? []
      : [
          {
            key: String(i),
            x,
            y: l.lapTimeS,
            hollow: false,
            muted: l.sessionId !== sessionId,
          },
        ];
  });
  if (drawn.length === 0) return null;
  const xs = drawn.map(p => p.x);
  // The reference line stays in frame even when every lap used more than it.
  const xDomain = padded(
    threshold ? [...xs, threshold.x] : xs,
    MIN_X_SPAN[measure],
  );
  const yDomain = padded(
    drawn.map(p => p.y),
    1,
  );
  const digits = measure === 'fuel' ? 2 : 1;
  return {
    points: drawn,
    xDomain,
    yDomain,
    xTicks: ticksOf(xDomain, v => v.toFixed(digits)),
    yTicks: ticksOf(yDomain, formatLapTime),
    threshold,
    n: drawn.length,
    thisSession: drawn.filter(p => !p.muted).length,
  };
}

export const POOLED_USE_HELP: readonly string[] = [
  'One dot per green lap at this track and car, from every session the plan reads. This session’s laps are at full ink, earlier sessions muted.',
  'Right is more used per lap. Up is a faster lap. The axis does not start at zero.',
  'The dashed line is the use per lap at which the plan’s stints reach with one stop fewer, at the plan’s rules.',
];
