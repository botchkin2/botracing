// Reads a corner slice file (tools/sessions/cornerSlices.mjs): every lap's
// window around one corner. Plain TypeScript with erasable syntax only, so the
// uploader's test runs it under Node. Arrays are integers, first value then
// differences; decoding is a running sum and divides by the file's own scale,
// so what comes out is the rounded recorded value, nothing smoothed.

export interface SliceSamples {
  /** Metres along the lap, in the app's frame. Ascending. */
  distanceM: number[];
  values: number[];
}

export type SliceChannel =
  | 'speedKph'
  | 'throttlePct'
  | 'brakePct'
  | 'steeringPct'
  | 'pathLateralM'
  | 'trackEdgeM';

export const SLICE_CHANNELS: SliceChannel[] = [
  'speedKph',
  'throttlePct',
  'brakePct',
  'steeringPct',
  'pathLateralM',
  'trackEdgeM',
];

export interface SliceLap {
  id: string;
  /** Distance of the first grid point, a multiple of stepM. */
  gridFromM: number;
  /** Seconds since the lap's first sample, on the 5 m grid from gridFromM. */
  timeS: number[];
  lat: number[];
  lon: number[];
  /** Recorded samples inside the window plus one either side; empty for a
   *  channel the lap has none of. */
  samples: Record<SliceChannel, SliceSamples>;
}

export interface CornerSlices {
  corner: number;
  apexM: number;
  lengthM: number;
  stepM: number;
  windowM: [number, number];
  laps: SliceLap[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === 'object' && !Array.isArray(v);

function numberArray(v: unknown, what: string): number[] {
  if (!Array.isArray(v) || v.some(x => typeof x !== 'number'))
    throw new Error(`corner slice: ${what} is not an array of numbers`);
  return v as number[];
}

function field(o: Record<string, unknown>, key: string, what: string) {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v))
    throw new Error(`corner slice: ${what}.${key} is not a number`);
  return v;
}

// First value, then differences: a running sum, divided by the scale.
function undelta(deltas: number[], digits: number): number[] {
  const scale = 10 ** digits;
  const out: number[] = [];
  let sum = 0;
  for (const d of deltas) {
    sum += d;
    out.push(sum / scale);
  }
  return out;
}

export function decodeCornerSlices(raw: unknown): CornerSlices {
  if (!isObj(raw)) throw new Error('corner slice: not an object');
  if (raw.v !== 1) throw new Error(`corner slice: unknown format ${raw.v}`);
  const digitsRaw = raw.digits;
  if (!isObj(digitsRaw)) throw new Error('corner slice: no digits');
  const digits = (key: string) => field(digitsRaw, key, 'digits');
  const window = numberArray(raw.windowM, 'windowM');
  if (window.length !== 2)
    throw new Error('corner slice: windowM is not [from, to]');
  const laps = Array.isArray(raw.laps) ? raw.laps : [];
  return {
    corner: field(raw, 'corner', 'file'),
    apexM: field(raw, 'apexM', 'file'),
    lengthM: field(raw, 'lengthM', 'file'),
    stepM: field(raw, 'stepM', 'file'),
    windowM: [window[0], window[1]],
    laps: laps.map((lap, i) => {
      const what = `laps[${i}]`;
      if (!isObj(lap))
        throw new Error(`corner slice: ${what} is not an object`);
      const samplesRaw = lap.samples;
      if (!isObj(samplesRaw))
        throw new Error(`corner slice: ${what}.samples is missing`);
      const samples = {} as Record<SliceChannel, SliceSamples>;
      for (const ch of SLICE_CHANNELS) {
        const s = samplesRaw[ch];
        if (!isObj(s))
          throw new Error(`corner slice: ${what}.samples.${ch} is missing`);
        samples[ch] = {
          distanceM: undelta(numberArray(s.d, `${what}.${ch}.d`), digits('d')),
          values: undelta(numberArray(s.v, `${what}.${ch}.v`), digits(ch)),
        };
      }
      if (typeof lap.id !== 'string')
        throw new Error(`corner slice: ${what}.id is not a string`);
      return {
        id: lap.id,
        gridFromM: field(lap, 'gridFromM', what),
        timeS: undelta(
          numberArray(lap.timeS, `${what}.timeS`),
          digits('timeS'),
        ),
        lat: undelta(numberArray(lap.lat, `${what}.lat`), digits('lat')),
        lon: undelta(numberArray(lap.lon, `${what}.lon`), digits('lon')),
        samples,
      };
    }),
  };
}

/**
 * A channel on a distance grid, from its recorded samples: linear between
 * neighbours, the end values held beyond them, as resampleTrace does. Inside
 * a slice's window this gives the same numbers as the whole-lap grid, because
 * the slice keeps one sample either side. NaN for a channel with no samples.
 */
export function gridFromSamples(
  s: SliceSamples,
  distancesM: number[],
): number[] {
  const xs = s.distanceM;
  const ys = s.values;
  if (xs.length === 0) return distancesM.map(() => NaN);
  let i = 0;
  return distancesM.map(x => {
    if (x <= xs[0]) return ys[0];
    const last = xs.length - 1;
    if (x >= xs[last]) return ys[last];
    while (i < last - 1 && xs[i + 1] < x) i++;
    while (i > 0 && xs[i] > x) i--;
    const span = xs[i + 1] - xs[i];
    const t = span > 0 ? (x - xs[i]) / span : 0;
    return ys[i] + (ys[i + 1] - ys[i]) * t;
  });
}
