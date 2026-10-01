// Lap time against tyre wear (round 7 1A "Lap time and wear", pit-wall thread
// 44): clean green laps of a whole race, wear as the mean % lost over the four
// wheels, split by the fuel at the start of the lap so the fuel effect (lighter
// is faster) is not counted as wear. A least-squares line per band shows that
// the two move together, not that one causes the other. Plain TypeScript, no
// imports.

/** Fewest laps in a band for a line. */
export const MIN_BAND_LAPS = 5;
/** A line needs the laps to span at least this much wear, % lost; below it the slope is noise. */
export const MIN_WEAR_SPAN_PCT = 2;
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
  /** Seconds per 1 % lost, least squares; null when there is no honest line. */
  slopeSPerPct: number | null;
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
  const base = {label, laps: band, slopeSPerPct: null, line: null};
  if (band.length < MIN_BAND_LAPS) return {...base, empty: 'few-laps'};
  const fit = leastSquares(band.map(l => ({x: l.lostPct, y: l.timeS})));
  // Tyres run inside one stint wear from one starting point: a band whose
  // laps span little wear has no slope to read (it needs a second set).
  if (!fit || span < MIN_WEAR_SPAN_PCT) return {...base, empty: 'one-set'};
  const x1 = Math.min(...xs);
  const x2 = Math.max(...xs);
  return {
    ...base,
    slopeSPerPct: fit.slope,
    line: {
      x1,
      y1: fit.intercept + fit.slope * x1,
      x2,
      y2: fit.intercept + fit.slope * x2,
    },
    empty: null,
  };
}
