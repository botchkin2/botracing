import {type LapPlace, type RaceClock} from '@/src/analysis/raceClock';

// Race and Compare share one moment (handoff R1: "Race playback's playhead is
// Compare's cursor"). Compare keeps its moment as a cursor distance on a lap
// in the URL; these turn that into race time and back. Pure.

export type RaceSelection = {
  /** Checked lap ids; their order carries no meaning. */
  laps: string[];
  /** The Ref lap when one is picked. */
  ref?: string | null;
  /** Highlighted lap id. */
  hl: string | null;
  /** Cursor distance, metres from the line; null when none is set. */
  cursorM: number | null;
};

/** `timeS` is the lap time, to find the set's best lap. */
export type LapRef = {
  id: string;
  lapNumber: number | null;
  timeS?: number | null;
};

/** What Race writes back: the cursor, and the highlighted lap when it changed. */
export type SelectionPatch = {hl: string | null; cursorM: number};

function anchorId(selection: RaceSelection, laps: LapRef[]): string | undefined {
  if (selection.hl) return selection.hl;
  if (selection.ref && selection.laps.includes(selection.ref))
    return selection.ref;
  const checked = laps.filter(l => selection.laps.includes(l.id));
  // The best of the checked laps; with no times known, the lowest lap number.
  const timed = checked.filter(l => l.timeS != null);
  if (timed.length > 0)
    return timed.reduce((a, b) => ((b.timeS as number) < (a.timeS as number) ? b : a)).id;
  return checked
    .filter(l => l.lapNumber != null)
    .sort((a, b) => (a.lapNumber as number) - (b.lapNumber as number))[0]?.id;
}

/**
 * Race time for the URL's cursor: on the highlighted lap, else the picked Ref
 * lap, else the best of the checked laps (never the first in the list). Null
 * when the URL has no cursor or the lap is not one the player drove in this
 * field (an old lap doc without a lap number).
 */
export function raceTimeFor(
  selection: RaceSelection,
  laps: LapRef[],
  clock: RaceClock,
): number | null {
  const lap = laps.find(l => l.id === anchorId(selection, laps));
  if (selection.cursorM == null || lap?.lapNumber == null) return null;
  return clock.timeAtLapDistance(lap.lapNumber, selection.cursorM);
}

/**
 * The URL patch for the player's place at the paused race time. The
 * highlighted lap follows only onto a lap that is in the selection, so
 * Race never adds a lap to Compare by itself.
 */
export function selectionFor(
  place: LapPlace,
  selection: RaceSelection,
  laps: LapRef[],
): SelectionPatch {
  const lap = laps.find(l => l.lapNumber === place.lapNumber);
  const follow = lap != null && selection.laps.includes(lap.id);
  return {
    hl: follow ? lap.id : selection.hl,
    cursorM: Math.round(place.distanceM),
  };
}
