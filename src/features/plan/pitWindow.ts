// The pit window (Botkin, pit-wall thread 44 #1379): for each stop of the
// full-tank plan, the earliest and the latest lap it can be taken and still
// reach the flag, with the other stops free to move. A range, not a
// recommendation. Pure; laps are racing laps, named by the caller ("after L18").

export type PitWindow = {
  /** 1-based stop number. */
  stop: number;
  /** The earliest racing lap the stop can come after. */
  earliest: number;
  /** The latest: the lap the tank runs out. */
  latest: number;
};

/**
 * `firstLaps` is how far the first load goes (the formation lap already taken
 * off it), `stintLaps` how far a full tank goes, `raceLaps` the race length,
 * and `stops` how many stops the full-tank plan makes.
 *
 * Latest stop k: every earlier stop as late as it can be, so the tank is
 * empty at `firstLaps + (k - 1) * stintLaps`, and never after the lap before
 * the last (a stop after the flag is no stop).
 * Earliest stop k: the stops from k on are each followed by a full tank, so
 * the laps left after it must fit in `(stops - k + 1)` of them.
 */
export function pitWindows(
  firstLaps: number,
  stintLaps: number,
  raceLaps: number,
  stops: number,
): PitWindow[] {
  if (stops < 1 || firstLaps < 1 || stintLaps < 1) return [];
  const out: PitWindow[] = [];
  for (let k = 1; k <= stops; k++) {
    const latest = Math.min(
      firstLaps + (k - 1) * stintLaps,
      raceLaps - 1 - (stops - k),
    );
    // Each stint is at least a lap, so stop k cannot come before lap k.
    const earliest = Math.max(k, raceLaps - (stops - k + 1) * stintLaps);
    if (earliest > latest) return [];
    out.push({stop: k, earliest, latest});
  }
  return out;
}
