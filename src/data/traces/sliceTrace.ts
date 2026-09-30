import {
  type CornerSlices,
  gridFromSamples,
  type SliceLap,
} from '@/src/analysis/cornerSlices';
import {type GridTrace} from '@/src/analysis/resample';

/**
 * One lap's slice as the GridTrace the Corner screen already draws from: the
 * same fields on the same 5 m grid over the whole lap. Inside the slice's
 * window the values are the lap's; beyond it the end values are held flat,
 * as `resampleTrace` holds a lap's ends, because the line builder needs a
 * number at every grid point (a NaN there voids the whole chunk of path it
 * falls in) and the screen only looks inside its own window. Grid channels are
 * rebuilt from the recorded samples the way `resampleTrace` builds them, and
 * `samples` are the recorded samples themselves; the window holds one sample
 * either side, so the two agree up to the file's rounding (docs/STORAGE.md).
 *
 * The held ends are not data: they are safe only while every window the
 * screen draws sits inside the slice window, which cornerWindows.ts
 * guarantees (the slice takes the wider of them). A view wider than those
 * windows would draw flat lines there.
 *
 * Not in a slice, so empty here: gear (Corner does not draw it).
 */
export function sliceToGridTrace(
  lap: SliceLap,
  slices: Pick<CornerSlices, 'stepM' | 'lengthM'>,
): GridTrace {
  const {stepM, lengthM} = slices;
  const n = Math.floor(lengthM / stepM) + 1;
  const distanceM = Array.from({length: n}, (_, i) => i * stepM);
  const blank = () => distanceM.map(() => NaN);
  const rebuilt = (samples: SliceLap['samples'][keyof SliceLap['samples']]) =>
    gridFromSamples(samples, distanceM);
  // Values known on the grid from `gridFromM`; the ends held either side.
  const at = Math.round(lap.gridFromM / stepM);
  const held = (values: number[]) => {
    if (values.length === 0) return blank();
    return distanceM.map((_, i) => {
      const k = Math.min(values.length - 1, Math.max(0, i - at));
      return values[k];
    });
  };
  const empty = {distanceM: [], values: []};
  return {
    stepM,
    distanceM,
    speedKph: rebuilt(lap.samples.speedKph),
    throttlePct: rebuilt(lap.samples.throttlePct),
    brakePct: rebuilt(lap.samples.brakePct),
    steeringPct: rebuilt(lap.samples.steeringPct),
    gear: blank(),
    lat: held(lap.lat),
    lon: held(lap.lon),
    timeS: held(lap.timeS),
    samples: {
      speedKph: lap.samples.speedKph,
      throttlePct: lap.samples.throttlePct,
      brakePct: lap.samples.brakePct,
      steeringPct: lap.samples.steeringPct,
      gear: empty,
      pathLateralM: lap.samples.pathLateralM,
      trackEdgeM: lap.samples.trackEdgeM,
    },
  };
}

/**
 * Whether the lap's samples reach the corner: a lap that never got there (an
 * out lap from the pits keeps one stray sample far along the track) has
 * nothing to draw, and holding that sample flat across the window would draw
 * a line that was never driven.
 */
export function sliceReachesApex(
  lap: SliceLap,
  slices: Pick<CornerSlices, 'apexM'>,
): boolean {
  const d = lap.samples.speedKph.distanceM;
  return (
    d.length >= 2 && d[0] <= slices.apexM && d[d.length - 1] >= slices.apexM
  );
}
