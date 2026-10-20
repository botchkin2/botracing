// Whether a lap trace's speed belongs to this car at this moment. A trace is looked up by lap distance, so it can be the
// wrong pass over that distance: R1 6's lap 0 holds the formation lap, and at 231 s (the race lap, 225 km/h) the
// trace at the same distance says 105 km/h, gear 2 (thread 94 #6419). Outside the recorded range the resampler also holds
// end values (`traceCovers`, resample.ts); this catches what that range cannot. The field's own speed for the car at
// that instant is independent of the trace, so a trace that disagrees with it is not this car's now.
// Plain TypeScript, no imports.

/** The field's speed comes from positions 0.2 s apart; this covers its noise and the gap between the two clocks. */
export const TRACE_SPEED_SLACK_KPH = 30;

export function traceAgrees(traceKph: number, fieldKph: number): boolean {
  return Number.isFinite(traceKph) && Math.abs(traceKph - fieldKph) <= TRACE_SPEED_SLACK_KPH;
}
