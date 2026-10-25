import {nearestSample} from '@/src/analysis/nativeSamples';
import {type GridTrace, traceCovers} from '@/src/analysis/resample';

/** What the HUD reads of the player's lap trace: the recorded samples at their own distances, not the 5 m grid. */
export type InputTrace = Pick<GridTrace, 'stepM' | 'recordedFromM' | 'recordedToM' | 'samples'>;

export type LivePedals = {throttlePct: number; brakePct: number; steeringPct: number};

/**
 * How far the engine's lap distance may be from the one React last handed over (the 5 Hz field update the trace was
 * matched to). Past this the frame is on another lap or a reset, and the 5 Hz inputs stand until React catches up.
 * A 5 Hz update is at most 0.2 s of a car at 300 km/h, 17 m; this leaves room for a late render.
 */
export const LIVE_MAX_OFFSET_M = 60;

/**
 * The player's pedals and wheel at a lap distance, each the nearest recorded sample (LMU: pedals 50 Hz, wheel 100 Hz),
 * so the HUD moves as often as the recording does and every number shown was recorded. Null where the lap's trace does
 * not reach the distance, or a channel has no sample.
 */
export function chaseInputsAt(trace: InputTrace, distanceM: number): LivePedals | null {
  if (!Number.isFinite(distanceM) || !traceCovers(trace, distanceM)) return null;
  const throttlePct = nearestSample(trace.samples.throttlePct, distanceM);
  const brakePct = nearestSample(trace.samples.brakePct, distanceM);
  const steeringPct = nearestSample(trace.samples.steeringPct, distanceM);
  if (throttlePct === null || brakePct === null || steeringPct === null) return null;
  return {throttlePct, brakePct, steeringPct};
}

/** One engine frame's followed car, as the engine drew it. */
export type ChaseFrame = {lapDistM: number; player: boolean};

/** How a view takes the engine's frames: one listener at a time, null to stop. */
export type FrameSubscribe = (listener: ((frame: ChaseFrame) => void) | null) => void;

/** The pedals for an engine frame, or null when the 5 Hz inputs should stand: not the player, or not near where React put it. */
export function livePedalsAt(trace: InputTrace, frame: ChaseFrame, anchorM: number): LivePedals | null {
  if (!frame.player || !(Math.abs(frame.lapDistM - anchorM) <= LIVE_MAX_OFFSET_M)) return null;
  return chaseInputsAt(trace, frame.lapDistM);
}

export function samePedals(a: LivePedals | null, b: LivePedals | null): boolean {
  if (a === null || b === null) return a === b;
  return a.throttlePct === b.throttlePct && a.brakePct === b.brakePct && a.steeringPct === b.steeringPct;
}
