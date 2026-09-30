import {
  gridFromSamples,
  type CornerSlices,
  type SliceLap,
} from '@/src/analysis/cornerSlices';
import {type GridTrace} from '@/src/analysis/resample';

/**
 * One lap's slice as the GridTrace the Corner screen already draws from: the
 * same fields on the same 5 m grid over the whole lap, with values inside the
 * slice's window and NaN outside it (no sample was kept there, and the screen
 * only reads its own window). Grid channels are rebuilt from the recorded
 * samples the way `resampleTrace` builds them, and `samples` are the recorded
 * samples themselves; the window holds one sample either side, so the two
 * agree up to the file's rounding (docs/STORAGE.md).
 *
 * Not in a slice, so empty here: gear (Corner does not draw it).
 */
export function sliceToGridTrace(
  lap: SliceLap,
  slices: Pick<CornerSlices, 'stepM' | 'lengthM' | 'windowM'>,
): GridTrace {
  const {stepM, lengthM, windowM} = slices;
  const n = Math.floor(lengthM / stepM) + 1;
  const distanceM = Array.from({length: n}, (_, i) => i * stepM);
  const blank = () => distanceM.map(() => NaN);
  const first = Math.ceil(windowM[0] / stepM);
  const last = Math.min(n - 1, Math.floor(windowM[1] / stepM));
  const windowXs = distanceM.slice(first, last + 1);
  const placed = (values: number[], at: number) => {
    const out = blank();
    values.forEach((v, k) => {
      if (at + k < n) out[at + k] = v;
    });
    return out;
  };
  const rebuilt = (samples: SliceLap['samples'][keyof SliceLap['samples']]) =>
    placed(gridFromSamples(samples, windowXs), first);
  const at = Math.round(lap.gridFromM / stepM);
  const empty = {distanceM: [], values: []};
  return {
    stepM,
    distanceM,
    speedKph: rebuilt(lap.samples.speedKph),
    throttlePct: rebuilt(lap.samples.throttlePct),
    brakePct: rebuilt(lap.samples.brakePct),
    steeringPct: rebuilt(lap.samples.steeringPct),
    gear: blank(),
    lat: lap.lat.length > 0 ? placed(lap.lat, at) : blank(),
    lon: lap.lon.length > 0 ? placed(lap.lon, at) : blank(),
    timeS: placed(lap.timeS, at),
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
