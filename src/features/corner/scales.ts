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

/** Speed (km/h): fitted to the window, from zero up. */
export function speedScale(
  arrays: readonly (readonly number[])[],
  window: [number, number],
  stepM: number,
): Scale {
  return fitScale(valuesInWindow(arrays, window, stepM), {symmetric: false});
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
