// Lap time against tyre wear (round 7 1A "Lap time and wear", pit-wall thread
// 44): clean green laps of a whole race, wear as the mean % lost over the four
// wheels, split by the fuel at the start of the lap so the fuel effect (lighter
// is faster) is not counted as wear. The number is one joint fit over every lap
// (time = a + b * wear + c * fuel): banding by fuel would still leave fuel inside
// each band, because later in a stint means less fuel and more wear, and for a
// GT3 that leftover can outweigh the wear effect (setup, pit-wall thread 44
// #1657). The panels stay as the picture; the dashed line in each is that
// band's own fit. It shows the two move together, not that one causes the
// other. Plain TypeScript, no imports.

/** Fewest laps in a band for a line. */
export const MIN_BAND_LAPS = 5;
/** A line needs the laps to span at least this much wear, % lost; below it the slope is noise. */
export const MIN_WEAR_SPAN_PCT = 2;
/** The joint fit is only identifiable when wear and fuel are not locked together (tyres carried across a stop). */
export const MAX_WEAR_FUEL_CORR = 0.9;
/** Bands by fuel at lap start (equal counts of laps). */
export const FUEL_BANDS = 3;

export type WearLap = {
  lapId: string;
  timeS: number;
  /** Mean over the four wheels of 100 minus wear left, %. */
  lostPct: number;
  /** Fuel in the tank at the start of the lap, litres. */
  fuelStartL: number;
};

export type WearBand = {
  /** "Fuel at start 38–46 L". */
  label: string;
  laps: WearLap[];
  /** The line's value at the band's least and most worn lap; null with no line. */
  line: {x1: number; y1: number; x2: number; y2: number} | null;
  /** Why there is no line, or null. */
  empty: 'few-laps' | 'one-set' | null;
};

export function leastSquares(
  pts: {x: number; y: number}[],
): {slope: number; intercept: number} | null {
  const n = pts.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return {slope, intercept: my - slope * mx};
}

/**
 * The laps split into FUEL_BANDS bands of equal count by fuel at lap start,
 * lowest fuel first, each with its fit. With fewer laps than bands times the
 * floor there is one band.
 */
export function wearBands(laps: WearLap[]): WearBand[] {
  const sorted = [...laps].sort((a, b) => a.fuelStartL - b.fuelStartL);
  const count = sorted.length >= FUEL_BANDS * MIN_BAND_LAPS ? FUEL_BANDS : 1;
  const bands: WearLap[][] = [];
  for (let i = 0; i < count; i++) {
    bands.push(
      sorted.slice(
        Math.round((i * sorted.length) / count),
        Math.round(((i + 1) * sorted.length) / count),
      ),
    );
  }
  return bands.map(b => bandOf(b, count === 1));
}

function bandOf(band: WearLap[], whole: boolean): WearBand {
  const fuel = band.map(l => l.fuelStartL);
  const lo = Math.min(...fuel);
  const hi = Math.max(...fuel);
  const label = whole
    ? 'All fuel loads'
    : `Fuel at start ${lo.toFixed(0)}–${hi.toFixed(0)} L`;
  const xs = band.map(l => l.lostPct);
  const span = band.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const base = {label, laps: band, line: null};
  if (band.length < MIN_BAND_LAPS) return {...base, empty: 'few-laps'};
  const fit = leastSquares(band.map(l => ({x: l.lostPct, y: l.timeS})));
  // Tyres run inside one stint wear from one starting point: a band whose
  // laps span little wear has no slope to read (it needs a second set).
  if (!fit || span < MIN_WEAR_SPAN_PCT) return {...base, empty: 'one-set'};
  const x1 = Math.min(...xs);
  const x2 = Math.max(...xs);
  return {
    ...base,
    line: {
      x1,
      y1: fit.intercept + fit.slope * x1,
      x2,
      y2: fit.intercept + fit.slope * x2,
    },
    empty: null,
  };
}

export type JointFit =
  | {
      kind: 'fit';
      /** Seconds per 1 % lost, fuel held fixed. */
      sPerPct: number;
      /** Seconds per litre of fuel at the start of the lap, wear held fixed. */
      sPerL: number;
      corr: number;
      n: number;
    }
  | {kind: 'none'; why: 'few-laps' | 'one-set' | 'locked'; corr: number | null};

/**
 * time = a + b * lostPct + c * fuelStartL over every lap, by least squares
 * (centred, so a 2x2 solve). None under MIN_BAND_LAPS laps, under
 * MIN_WEAR_SPAN_PCT of wear, or when |corr(wear, fuel)| is MAX_WEAR_FUEL_CORR
 * or more: the two then cannot be told apart.
 */
export function jointFit(laps: WearLap[]): JointFit {
  const n = laps.length;
  if (n < MIN_BAND_LAPS) return {kind: 'none', why: 'few-laps', corr: null};
  const mean = (f: (l: WearLap) => number) =>
    laps.reduce((a, l) => a + f(l), 0) / n;
  const mx = mean(l => l.lostPct);
  const mf = mean(l => l.fuelStartL);
  const my = mean(l => l.timeS);
  let sxx = 0;
  let sff = 0;
  let sxf = 0;
  let sxy = 0;
  let sfy = 0;
  for (const l of laps) {
    const x = l.lostPct - mx;
    const f = l.fuelStartL - mf;
    const y = l.timeS - my;
    sxx += x * x;
    sff += f * f;
    sxf += x * f;
    sxy += x * y;
    sfy += f * y;
  }
  const xs = laps.map(l => l.lostPct);
  const span = Math.max(...xs) - Math.min(...xs);
  if (span < MIN_WEAR_SPAN_PCT || sxx === 0)
    return {kind: 'none', why: 'one-set', corr: null};
  const corr = sff === 0 ? 1 : sxf / Math.sqrt(sxx * sff);
  const det = sxx * sff - sxf * sxf;
  if (Math.abs(corr) >= MAX_WEAR_FUEL_CORR || det <= 0)
    return {kind: 'none', why: 'locked', corr};
  return {
    kind: 'fit',
    sPerPct: (sff * sxy - sxf * sfy) / det,
    sPerL: (sxx * sfy - sxf * sxy) / det,
    corr,
    n,
  };
}
