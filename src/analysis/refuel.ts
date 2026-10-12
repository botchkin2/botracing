// How long a stop's refuelling takes, from the litres added (pit-wall thread
// 43, camber #1076/#1250). Plain TypeScript with erasable syntax only.
//
// The rate is measured on GT3 only: about 3.4 L/s, from the ramp of the fuel
// level inside the pit window on 5 stops (thread 34 audit; max 0.17 to 0.20 L
// per 20 Hz step). It is not measured for LMP2 or Hypercar, so there the time
// is left out, never guessed, until someone measures it. The number a screen
// prints is computed (litres / rate), and the screen says so.

// A refuel stop, for a session with no visit block: the same thresholds the
// uploader's visit classifier uses (tools/sessions/pitVisit.mjs imports them
// from here). Below them is sensor jitter, not a refuel.
/** Fuel added (L) that makes a stop a refuel. */
export const REFUEL_FUEL_MIN_L = 1;
/** VE added (%) that makes a stop a refuel. */
export const REFUEL_VE_MIN_PCT = 0.5;

/** Litres per second while the car is being refuelled. */
export const REFUEL_L_PER_S = 3.4;

/** The car classes the rate has been measured on. */
export const REFUEL_MEASURED_CLASSES: readonly string[] = ['GT3'];

/** How many stops the rate was measured on, for the scope line. */
export const REFUEL_MEASURED_STOPS = 5;

/** Whether the rate is known for this car class (the session's `car.class`). */
export function refuelMeasured(carClass: string): boolean {
  // Trimmed and case-blind, as the radar matches a class.
  const wanted = carClass.trim().toLowerCase();
  return REFUEL_MEASURED_CLASSES.some(c => c.toLowerCase() === wanted);
}

/**
 * Seconds of refuelling for litres added, or null where the rate is not
 * measured for the class (or nothing was added).
 */
export function refuelS(litres: number, carClass: string): number | null {
  if (!refuelMeasured(carClass) || !(litres > 0)) return null;
  return litres / REFUEL_L_PER_S;
}

/** "refuel at 3.4 L/s · GT3, measured on 5 stops", or null where not measured. */
export function refuelScope(carClass: string): string | null {
  if (!refuelMeasured(carClass)) return null;
  return `refuel at ${REFUEL_L_PER_S.toFixed(
    1,
  )} L/s · ${carClass}, measured on ${REFUEL_MEASURED_STOPS} stops`;
}

/**
 * How fast fuel went in during one pit window, measured from the fuel level
 * itself: the litres the level rose over the time from its first rise to its
 * last, plus one step (the level is logged at 20 Hz and held between samples,
 * so the last rise ends a step later). This is the pump, not the stop: a stop
 * also stands still for tyres, repairs and the lollipop, so litres over the
 * stop's time reads several times too slow (dc68, Daytona 29 Sep: 4.04 L in
 * 1.2 s, 3.37 L/s, during a 60.6 s repair). `fuelL` and `t` are parallel; the
 * window is the index range [from, to]. Null when less than
 * REFUEL_FUEL_MIN_L went in, or the rise has no length.
 */
export function fillRateLPerS(
  fuelL: ArrayLike<number>,
  t: ArrayLike<number>,
  from: number,
  to: number,
): number | null {
  let added = 0;
  let first = -1;
  let last = -1;
  let step = Infinity;
  for (let i = Math.max(from + 1, 1); i <= to && i < fuelL.length; i++) {
    const d = fuelL[i] - fuelL[i - 1];
    if (!(d > 0)) continue;
    added += d;
    if (first < 0) first = i;
    else step = Math.min(step, t[i] - t[last]);
    last = i;
  }
  if (added < REFUEL_FUEL_MIN_L || first < 0) return null;
  const span = t[last] - t[first] + (Number.isFinite(step) ? step : 0);
  return span > 0 ? added / span : null;
}

/**
 * The refuel rate a plan uses: the median pump rate measured on the driver's
 * own race stops at this track and car (`fillRateLPerS`, any visit that added a
 * litre or more), else the GT3 rate measured in thread 34, else none (the time
 * is left out, never guessed). `stops` is how many fills it rests on.
 */
export type RefuelRate = {lPerS: number; stops: number; measured: boolean};

/** The pump rates measured on the stops, then the GT3 default, then null. */
export function refuelRateOf(
  fillsLPerS: (number | null)[],
  carClass: string,
): RefuelRate | null {
  const fills = fillsLPerS
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (fills.length > 0) {
    const mid = fills.length >> 1;
    const lPerS =
      fills.length % 2 ? fills[mid] : (fills[mid - 1] + fills[mid]) / 2;
    return {lPerS, stops: fills.length, measured: true};
  }
  return refuelMeasured(carClass)
    ? {lPerS: REFUEL_L_PER_S, stops: REFUEL_MEASURED_STOPS, measured: false}
    : null;
}

/** Seconds of refuelling for litres added at a rate; null without a rate or litres. */
export function refuelSecondsAt(
  litres: number,
  rate: RefuelRate | null,
): number | null {
  return rate && litres > 0 ? litres / rate.lPerS : null;
}

/** "refuel at 3.4 L/s · your 2 stops here", or the GT3 default's line; null without a rate. */
export function refuelRateScope(rate: RefuelRate | null): string | null {
  if (!rate) return null;
  const at = `refuel at ${rate.lPerS.toFixed(1)} L/s`;
  return rate.measured
    ? `${at} · your ${rate.stops} ${rate.stops === 1 ? 'stop' : 'stops'} here`
    : `${at} · GT3, measured on ${rate.stops} stops`;
}
