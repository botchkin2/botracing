// One car's off-track stretches over race time: when, on which lap, and where
// on the road (D52). Plain TypeScript, erasable syntax only: Node runs it.
//
// The rule is the Race map's own (`stateOf` in raceState.ts: wheels past the
// measured edge, held OFF_HOLD_S), so a mark on the lanes is the same moment a
// dot shows its dashed ring. Nothing is guessed: a stretch is a run of
// consecutive updates in the 'off' state and nothing else. The state flips to
// off only once the offset has held OFF_HOLD_S, so a stretch starts k-1 updates
// before the first 'off' one: the hold already proved those samples off.
import type {RaceClock} from './raceClock';
import {OFF_HOLD_S, type RacePrep, stateOf} from './raceState';

export interface OffTrackEvent {
  /** Race time of the first update off the road. */
  fromS: number;
  /** Race time the last update off the road ends (one update length later). */
  toS: number;
  /** Lap number as the lanes label it (from 1); null for another car, which has no lap clock. */
  lap: number | null;
  /** Metres along the lap at the first update off the road. */
  lapDistM: number;
  /** World position at the first update off the road. */
  xM: number;
  zM: number;
}

/**
 * Every off-track stretch of car `carIndex` (an index into `prep.field.cars`).
 * `onPitLane` drops stretches that touch the pit lane: the pit road sits past
 * the fixed 7.5 m limit and is not an off (see features/race/pitLaneState).
 */
export function offTrackEvents(
  prep: RacePrep,
  clock: RaceClock,
  carIndex: number,
  onPitLane: (xM: number, zM: number) => boolean = () => false,
): OffTrackEvent[] {
  const car = prep.field.cars[carIndex];
  if (!car) return [];
  const dtS = 1 / prep.field.hz;
  const times = prep.field.timeS;
  const n = times.length;
  const backdate = Math.max(1, Math.round(OFF_HOLD_S * prep.field.hz)) - 1;
  const out: OffTrackEvent[] = [];
  let start = -1;
  let lastEnd = -1;
  let touchesLane = false;
  const close = (last: number) => {
    if (start >= 0 && !touchesLane) {
      const place = car.player ? clock.playerAt(times[start]) : null;
      out.push({
        fromS: times[start],
        toS: times[last] + dtS,
        lap: place ? place.lapNumber + 1 : null,
        lapDistM: car.lapDistM[start],
        xM: car.xM[start],
        zM: car.zM[start],
      });
    }
    if (start >= 0) lastEnd = last;
    start = -1;
    touchesLane = false;
  };
  for (let u = 0; u < n; u++) {
    if (stateOf(prep, carIndex, u) === 'off') {
      if (start < 0) {
        start = Math.max(lastEnd + 1, u - backdate);
        for (let j = start; j < u; j++) {
          if (onPitLane(car.xM[j], car.zM[j])) touchesLane = true;
        }
      }
      if (onPitLane(car.xM[u], car.zM[u])) touchesLane = true;
    } else {
      close(u - 1);
    }
  }
  close(n - 1);
  return out;
}
