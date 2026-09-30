import {type Field, updateAt} from '@/src/analysis/field';
import {type Radar, RADAR_RANGE_M, radarAt} from '@/src/analysis/radar';
import {type RaceClock} from '@/src/analysis/raceClock';

// The field radar's inputs from Compare's cursor (round 3 R2b): the playing
// lap's number and the cursor distance give a race time; the radar draws the
// 5 Hz sample at or before it, even while the map and charts interpolate.

export interface RadarView {
  radar: Radar | null;
  /** The sample's race time, "m:ss.s", printed on the radar. */
  sampleLabel: string;
}

/** Seconds as "m:ss.s", to the tenth (one 5 Hz sample is 0.2 s). */
export function raceClockLabel(timeS: number): string {
  const tenths = Math.floor(timeS * 10 + 1e-6);
  const m = Math.floor(tenths / 600);
  const s = tenths - m * 600;
  return `${m}:${String(Math.floor(s / 10)).padStart(2, '0')}.${s % 10}`;
}

/**
 * Null when the player never reached this point of this lap (a lap the field
 * does not cover, e.g. an out lap from before the recorder started).
 */
export function radarAtCursor(
  field: Field,
  clock: RaceClock,
  lapNumber: number,
  cursorM: number,
  width: number,
  height: number,
): RadarView | null {
  const t = clock.timeAtLapDistance(lapNumber, cursorM);
  if (t == null) return null;
  const at = updateAt(field.timeS, Math.floor(t * field.hz) / field.hz);
  if (at < 0) return null;
  return {
    radar: radarAt(field, at, RADAR_RANGE_M, (RADAR_RANGE_M * width) / height),
    sampleLabel: raceClockLabel(field.timeS[at]),
  };
}
