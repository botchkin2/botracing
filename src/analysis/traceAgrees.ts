// Whether a lap trace's speed belongs to where the car is. A trace is looked up by lap distance, and outside the stretch
// it recorded (a lap that began on the grid behind the line, a tray that started late) the resampler holds its end
// values, so the HUD would print a standing N / 0 km/h at 130 mph (R1 6, thread 94 #6419). The field's own speed for the
// car at that instant is independent of the trace, so a trace that disagrees with it is not this car's here.
// Plain TypeScript, no imports.

/** The field's speed comes from positions 0.2 s apart; this covers its noise and the gap between the two clocks. */
export const TRACE_SPEED_SLACK_KPH = 30;

export function traceAgrees(traceKph: number, fieldKph: number): boolean {
  return Number.isFinite(traceKph) && Math.abs(traceKph - fieldKph) <= TRACE_SPEED_SLACK_KPH;
}
