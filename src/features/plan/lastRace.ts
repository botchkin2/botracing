// "Your last race here" (round 5, frame 1; pit-wall thread 43): the newest race
// at a track and car, as data. The Plan screen prints it under the chips and
// the Track page's Plan card reads its date and length. Pure.
import type {RaceFacts} from '@/src/analysis/fuelPlan';

export type LastRace = {
  sessionId: string;
  startedAt: string;
  /** Racing laps driven, the formation lap not counted. */
  raceLaps: number;
  /** One per stop, by the lap the pit lane was entered ("L24"), and what was left at entry. */
  stops: {lap: string; fuelL: number | null; vePct: number | null}[];
  /** The tank at the end of the last whole lap ("L72"); null without a fuel level. */
  end: {lap: string; fuelL: number | null; vePct: number | null} | null;
  /** What the car started the race with: litres, and % of the full VE load; null without the channel. */
  start: {fuelL: number | null; vePct: number | null};
  leftEarly: boolean;
  playerLapsDone: number | null;
  classLeaderLapsDone: number | null;
};

/** The race's facts as the Plan screen shows them; the stop and end laps are the app's lap names. */
export function lastRaceOf(
  sessionId: string,
  facts: RaceFacts | null,
): LastRace | null {
  if (!facts) return null;
  return {
    sessionId,
    startedAt: facts.startedAt,
    raceLaps: facts.raceLaps,
    stops: facts.stops.map(s => ({
      lap: `L${s.lapIndex}`,
      fuelL: s.fuelL,
      vePct: s.vePct,
    })),
    start: {fuelL: facts.startL, vePct: facts.startVePct ?? null},
    leftEarly: facts.leftEarly === true,
    playerLapsDone: facts.playerLapsDone ?? null,
    classLeaderLapsDone: facts.classLeaderLapsDone ?? null,
    end: facts.end
      ? {
          lap: `L${facts.end.lapIndex}`,
          fuelL: facts.end.fuelL,
          vePct: facts.end.vePct,
        }
      : null,
  };
}

/**
 * The one line under "Your last race here": the stops by the lap the pit lane
 * was entered (as the pit stops card names them), and what was left at the
 * end of the last whole lap. One numbering, the lap table's: no lap count
 * beside "L21", which counts the formation lap (apex, #1309). VE is left out
 * of a fuel-only race.
 * "2 stops at L25, L49 · 4.9 L / 3 % VE left at the end of L73"
 */
export function lastRaceLine(race: LastRace): string {
  const dnf =
    race.leftEarly &&
    race.playerLapsDone != null &&
    race.classLeaderLapsDone != null
      ? `DNF at L${race.playerLapsDone} of L${race.classLeaderLapsDone}+`
      : null;
  const stops =
    race.stops.length === 0
      ? 'no stop'
      : `${race.stops.length} ${
          race.stops.length === 1 ? 'stop' : 'stops'
        } at ${race.stops.map(s => s.lap).join(', ')}`;
  const left = race.end
    ? [
        race.end.fuelL != null && `${race.end.fuelL.toFixed(1)} L`,
        race.end.vePct != null && `${Math.round(race.end.vePct)} % VE`,
      ].filter(Boolean)
    : [];
  const end =
    race.end && left.length > 0
      ? ` · ${left.join(' / ')} left at the end of ${race.end.lap}`
      : '';
  return dnf ? `${dnf} · ${stops}${end}` : `${stops}${end}`;
}
