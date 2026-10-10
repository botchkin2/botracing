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
