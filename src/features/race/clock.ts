// The Race screen's clock (handoff R1): race time in seconds from the first
// field update. Pure: `useRaceClock` drives it from animation frames.

/**
 * Playback rates. A race is 15 to 60 minutes, so Race goes to 16x where Compare
 * (a lap of a few seconds at a time) stops at 2x (Botkin, pit-wall thread 27 #917).
 */
export const RACE_RATES = [0.25, 0.5, 1, 2, 4, 8, 16] as const;
export type RaceRate = (typeof RACE_RATES)[number];

/** Longest step one tick may take, so a resume after the app was in the
 * background does not jump the race ahead (same cap as Compare's playback). */
export const MAX_STEP_S = 0.25;

/** One playback tick: `dtS` of wall time at `rate`, stopping at the end. */
export function stepClock(
  timeS: number,
  dtS: number,
  rate: number,
  endS: number,
): {timeS: number; ended: boolean} {
  const next = timeS + Math.min(MAX_STEP_S, Math.max(0, dtS)) * rate;
  return next >= endS
    ? {timeS: endS, ended: true}
    : {timeS: next, ended: false};
}

/** Paused, the clock rests on a real sample: the nearest update (R1, 5 Hz honesty). */
export function snapClock(timeS: number, hz: number): number {
  return hz > 0 ? Math.round(timeS * hz) / hz : timeS;
}

/** Race time as "21:23.4" (m:ss.s), the clock beside the transport. */
export function clockLabel(timeS: number): string {
  const tenths = Math.round(Math.max(0, timeS) * 10);
  const minutes = Math.floor(tenths / 600);
  const seconds = (tenths - minutes * 600) / 10;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

/** Seconds a step button moves the clock (the phone's -5 s and +5 s). */
export const STEP_S = 5;

/** The clock moved by `deltaS`, kept inside the race. */
export function stepBy(timeS: number, deltaS: number, endS: number): number {
  return Math.min(endS, Math.max(0, timeS + deltaS));
}

/** The next playback rate, back to the slowest after the fastest: the phone's one rate chip. */
export function nextRate(rate: RaceRate): RaceRate {
  const i = RACE_RATES.indexOf(rate);
  return RACE_RATES[(i + 1) % RACE_RATES.length];
}
