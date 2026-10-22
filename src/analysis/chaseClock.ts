// The 3D chase's own race clock. The app's clock moves every frame too, but React may skip a frame; the engine runs on
// from its last anchor and takes the app's time only when the two part (a seek, play or pause, a new rate), so a car
// never stands still or steps (thread 93). Plain TypeScript, no imports.

/**
 * A gap larger than this (seconds of race time per unit of rate) between the two clocks is a seek. React hands the app
 * clock over at the field's 5 Hz in 3D (useRaceClock tickHz), so a late or early one is up to 0.2 s of wall time plus its
 * render apart; a real seek is seconds.
 */
export const SEEK_S = 0.6;
/**
 * The most a gap may be and still not be a seek, whatever the rate: the +-5 s buttons at 16x are a 5 s gap, and a gap that
 * scaled to 9.6 s there would let the 3D glide on past them. At 16x the 5 Hz tick lag is 3.2 s of race, so this clears it.
 */
export const SEEK_MAX_S = 4.5;

export interface ChaseClock {
  /** Race time at wall time `atMs`. */
  timeS: number;
  atMs: number;
  playing: boolean;
  rate: number;
  /** The app's time at its last report: a paused app time that differs from it is a seek. */
  appS: number;
}

/** Race time now: running at `rate` from the anchor while playing, held while paused. */
export function clockAt(c: ChaseClock, nowMs: number): number {
  return c.playing ? c.timeS + ((nowMs - c.atMs) / 1000) * c.rate : c.timeS;
}

/** The clock after the app reports its time, play state and rate at wall time `nowMs`. */
export function followApp(c: ChaseClock, app: {timeS: number; playing: boolean; rate: number}, nowMs: number): ChaseClock {
  const ran = clockAt(c, nowMs);
  const changed = app.playing !== c.playing || app.rate !== c.rate;
  const parted = Math.abs(app.timeS - ran) > Math.min(SEEK_MAX_S, SEEK_S * Math.max(1, app.rate));
  const at = (timeS: number): ChaseClock => ({timeS, atMs: nowMs, playing: app.playing, rate: app.rate, appS: app.timeS});
  // paused and the app has said nothing new: nothing moves, whatever gap a pause hold left
  if (!app.playing && !c.playing && app.rate === c.rate && app.timeS === c.appS) return c;
  if (parted) return at(app.timeS);
  if (!app.playing) {
    // pausing holds where the 3D had run to, not the app's last 5 Hz tick (up to 0.2 s of wall time behind: the cars
    // would step back and the camera with them); a paused app time that then moves is a scrub
    return c.playing ? at(ran) : at(app.timeS);
  }
  if (changed) return at(ran);
  return c;
}
