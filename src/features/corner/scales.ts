// The Corner charts' y scales. Physical channels are fixed; a difference or a
// speed is fitted to the laps in the window, through the shared scale function,
// so every chart reads the same way (see src/charts/scale.ts).

import {fitScale, fixedScale, type Scale} from '@/src/charts/scale';
import {signedSeconds, withUnit} from '@/src/charts/tickFormat';

/** The values of each array inside the window, by the grid's index range. */
export function valuesInWindow(
  arrays: readonly (readonly number[])[],
  [a, b]: [number, number],
  stepM: number,
): number[] {
  const from = Math.max(0, Math.floor(a / stepM));
  const to = Math.ceil(b / stepM);
  const out: number[] = [];
  for (const arr of arrays)
    for (let i = from; i <= Math.min(to, arr.length - 1); i++)
      if (Number.isFinite(arr[i])) out.push(arr[i]);
  return out;
}

/** Speed (km/h): fitted to the window, min to max. */
export function speedScale(
  arrays: readonly (readonly number[])[],
  window: [number, number],
  stepM: number,
): Scale {
  return fitScale(valuesInWindow(arrays, window, stepM), {
    symmetric: false,
    format: withUnit('km/h'),
  });
}

/** Delta from the entry (s): symmetric, so faster and slower read alike. */
export function deltaScale(
  arrays: readonly (readonly number[])[],
  window: [number, number],
  stepM: number,
): Scale {
  return fitScale(valuesInWindow(arrays, window, stepM), {
    symmetric: true,
    format: signedSeconds,
  });
}

/** Brake and throttle (%): 0 to 100, with 4 % room so neither end sits on the edge. */
export function pedalScale(): Scale {
  return {...fixedScale(0, 100, 25, withUnit('%')), lo: -4, hi: 104};
}

/** Steering (% of full lock): fixed at ±100 %. */
export function steeringScale(): Scale {
  return fixedScale(-100, 100, 50, withUnit('%'));
}

/** The least span the height strip shows, metres: under it the profile's measurement noise would read as a hill. */
export const MIN_HEIGHT_SPAN_M = 5;

/**
 * Height (m): fitted to the window, min to max, but never tighter than
 * MIN_HEIGHT_SPAN_M, centred on the window's middle height: a flat stretch
 * draws flat, not as a hill stretched to the strip's height.
 */
export function heightScale(
  heights: readonly number[],
  window: [number, number],
  stepM: number,
): Scale {
  const v = valuesInWindow([heights], window, stepM);
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const fitted =
    v.length > 0 && hi - lo < MIN_HEIGHT_SPAN_M
      ? [
          (lo + hi) / 2 - MIN_HEIGHT_SPAN_M / 2,
          (lo + hi) / 2 + MIN_HEIGHT_SPAN_M / 2,
        ]
      : v;
  return fitScale(fitted, {symmetric: false, format: withUnit('m')});
}

/** Racing line (m): ±the road's own half width, from the measured road edges in the window. */
export function lateralScale(
  edges: readonly (readonly number[])[],
  window: [number, number],
  stepM: number,
): Scale {
  return fitScale(valuesInWindow(edges, window, stepM), {
    symmetric: true,
    format: withUnit('m'),
  });
}

/** One lap's channels for the fitted scales, with whether it is comparable. */
export type ScaleLine = {
  comparable: boolean;
  speedKph: readonly number[];
  deltaS: readonly number[];
  trackEdgeM: readonly number[];
};

export type CornerScales = {speed: Scale; delta: Scale; lateral: Scale};

/**
 * The three fitted scales of the Corner charts. Only the comparable laps set
 * them: a lap outside that set is drawn clipped, never stretches an axis. When
 * no lap is comparable, every lap sets them, so a chart still has a range.
 */
export function cornerScales(
  lines: readonly ScaleLine[],
  window: [number, number],
  stepM: number,
): CornerScales {
  const comparable = lines.filter(l => l.comparable);
  const fit = comparable.length > 0 ? comparable : lines;
  return {
    speed: speedScale(
      fit.map(l => l.speedKph),
      window,
      stepM,
    ),
    delta: deltaScale(
      fit.map(l => l.deltaS),
      window,
      stepM,
    ),
    lateral: lateralScale(
      fit.map(l => l.trackEdgeM),
      window,
      stepM,
    ),
  };
}
