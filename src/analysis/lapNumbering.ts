// The one way the app numbers and names a lap (pit-wall thread 99, row FML).
// Botkin: "formation lap should never anywhere in the app be referred to as
// lap1 ... there are no laps before a green flag". In a race, L1 is the lap
// that starts at the green flag; the formation is the word "Formation". In
// other sessions a lap is named by its place in driving order.
//
// A race's number comes from the game's own lap counter (the lap doc's
// `lapNumber`), never from where the lap sits in the list: a capture that
// starts late (Daytona 10-07 starts in the pits after lap 1) has no first lap
// to count from. Measured on his races (__fixtures__/raceLapStarts.json):
// - LMU counts laps completed (mTotalLaps) and lap 1 starts at the green, a
//   few metres behind the line, with the counter still 0 (Silverstone 10-15,
//   Sebring 10-21: the results file's lap 1 starts at the green). So racing
//   lap = counter + 1, and the counter-0 lap holds the formation and lap 1
//   together: it is L1.
// - iRacing counts laps started (Lap): the green comes before the line on a
//   rolling start, and the counter turns 1 at the line (Road Atlanta 08-27).
//   So racing lap = counter, and the counter-0 lap is the formation.

/** Where a lap sits and what the game counted, as the lap doc has them. */
export type LapCount = {
  sim: string;
  race: boolean;
  /** The game's lap counter when the lap began; null on old lap docs. */
  lapNumber: number | null;
  /** Position in driving order, from 1. */
  lapIndex: number;
};

/**
 * The lap's number as the app shows it: in a race, counted from the green
 * flag, null for the formation lap; elsewhere (and on a race lap doc with no
 * counter) its place in driving order.
 */
export function lapNoOf({sim, race, lapNumber, lapIndex}: LapCount): number | null {
  if (!race || lapNumber == null) return lapIndex;
  if (sim === 'iracing') return lapNumber > 0 ? lapNumber : null;
  return lapNumber + 1;
}

/** "L7", or "Formation" for the lap before the green flag. */
export function lapLabel(lapNo: number | null): string {
  return lapNo == null ? 'Formation' : `L${lapNo}`;
}

/** "L3–L9" over a run of laps; one lap reads "L3". */
export function lapRangeLabel(first: number | null, last: number | null): string {
  return first === last
    ? lapLabel(first)
    : `${lapLabel(first)}–${lapLabel(last)}`;
}
