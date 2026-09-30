// Facts read off the zoomed traces (pure), so the screen can say them in words.

/** Below this a pedal reads as off: the sensor's noise floor, in percent. */
const PEDAL_OFF_PCT = 2;

/** The largest value in `arrays` across the window [a, b] metres, or 0 with none. */
export function peakIn(
  arrays: number[][],
  [a, b]: [number, number],
  stepM: number,
): number {
  const from = Math.max(0, Math.floor(a / stepM));
  const to = Math.ceil(b / stepM);
  let peak = 0;
  for (const arr of arrays)
    for (let i = from; i <= Math.min(to, arr.length - 1); i++)
      if (arr[i] > peak) peak = arr[i];
  return peak;
}

/** True when no drawn lap touches the brake anywhere in the window. */
export function noBrakeIn(
  brakePct: number[][],
  windowM: [number, number],
  stepM: number,
): boolean {
  return (
    brakePct.length > 0 && peakIn(brakePct, windowM, stepM) < PEDAL_OFF_PCT
  );
}

/** "Showing 13 of 44 laps", or null when every lap is drawn. */
export function lapsShownText(shown: number, total: number): string | null {
  return shown < total ? `Showing ${shown} of ${total} laps` : null;
}
