// "Your last race here" (round 5, frame 1; pit-wall thread 43): the newest race
// at a track and car, as data. The Plan screen prints it under the chips and
// the Track page's Plan card reads its date and length. Pure.
import type {RaceFacts} from '@/src/analysis/fuelPlan';
import {lapLabel} from '@/src/analysis/lapNumbering';

export type LastRace = {
  sessionId: string;
  startedAt: string;
  /** Racing laps driven, the formation lap not counted. */
  raceLaps: number;
  /**
   * One per pit visit, by the lap the pit lane was entered ("L24"), what was
   * left at entry, and why: a service is a stop, a repair or a penalty is named
   * as what it was (null kind: a block from before it was stored, read as a stop).
   */
  stops: {
    lap: string;
    fuelL: number | null;
    vePct: number | null;
    kind: string | null;
    detail: string | null;
  }[];
  /** The tank at the end of the last whole lap ("L72"); null without a fuel level. */
  end: {lap: string; fuelL: number | null; vePct: number | null} | null;
  /** What the car started the race with: litres, and % of the full VE load; null without the channel. */
  start: {fuelL: number | null; vePct: number | null};
  leftEarly: boolean;
  playerLapsDone: number | null;
  classLeaderLapsDone: number | null;
};

/**
 * The race "your last race here" shows: the newest race of the planned event,
 * or of the track and car with none given. A session with no VE ratio (a block
 * from before analysis version 11) is in no rule set, so a newest race without
 * one is skipped and the newest race of the set is shown (pit-wall thread 104).
 * `sessions` is newest first.
 */
export function lastRaceSessionOf<S extends {id: string; sessionType: string}>(
  sessions: S[],
  event: {sessionIds: string[]} | null,
): S | null {
  return (
    sessions.find(
      s =>
        s.sessionType === 'R' && (event == null || event.sessionIds.includes(s.id)),
    ) ?? null
  );
}

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
      lap: lapLabel(s.lap),
      fuelL: s.fuelL,
      vePct: s.vePct,
      kind: s.kind ?? null,
      detail: s.detail ?? null,
    })),
    start: {fuelL: facts.startL, vePct: facts.startVePct ?? null},
    leftEarly: facts.leftEarly === true,
    playerLapsDone: facts.playerLapsDone ?? null,
    classLeaderLapsDone: facts.classLeaderLapsDone ?? null,
    end: facts.end
      ? {
          lap: lapLabel(facts.end.lap),
          fuelL: facts.end.fuelL,
          vePct: facts.end.vePct,
        }
      : null,
  };
}

/**
 * The one line under "Your last race here": the stops by the lap the pit lane
 * was entered (as the pit stops card names them), and what was left at the
 * end of the last whole lap. One numbering, the lap table's, from the green
 * flag (apex, #1309). VE is left out of a fuel-only race.
 * "2 stops at L25, L49 · 4.9 L / 3 % VE left at the end of L73". A visit that
 * was not a service is named by what it was, not counted as a stop:
 * "no stop · repair L11 · stop-go L12" (canard's audit, #4166).
 */
export function lastRaceLine(race: LastRace): string {
  const dnf =
    race.leftEarly &&
    race.playerLapsDone != null &&
    race.classLeaderLapsDone != null
      ? `DNF at ${lapLabel(race.playerLapsDone)} of ${lapLabel(
          race.classLeaderLapsDone,
        )}+`
      : null;
  // A service, or a visit from a block that does not say, is a stop.
  const services = race.stops.filter(
    s => s.kind == null || s.kind === 'service',
  );
  const stops =
    services.length === 0
      ? 'no stop'
      : `${services.length} ${
          services.length === 1 ? 'stop' : 'stops'
        } at ${services.map(s => s.lap).join(', ')}`;
  const others = race.stops
    .filter(s => s.kind != null && s.kind !== 'service')
    .map(s => `${visitName(s.kind as string, s.detail)} ${s.lap}`);
  const visits = [stops, ...others].join(' · ');
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
  return dnf ? `${dnf} · ${visits}${end}` : `${visits}${end}`;
}

/** A visit that was not a service, as the line names it: "repair", "stop-go", "drive-through", "pit lane". */
function visitName(kind: string, detail: string | null): string {
  if (kind === 'penalty') return detail ?? 'penalty';
  if (kind === 'repair') return 'repair';
  if (kind === 'through') return 'through the lane';
  return 'pit visit';
}
