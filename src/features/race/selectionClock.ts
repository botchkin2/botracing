import {type LapPlace, type RaceClock} from '@/src/analysis/raceClock';

// Race and Compare share one moment (handoff R1: "Race playback's playhead is
// Compare's cursor"). Compare keeps its moment as a cursor distance on a lap
// in the URL; these turn that into race time and back. Pure.

export type RaceSelection = {
  /** Lap ids; the first is the reference. */
  laps: string[];
  /** Highlighted lap id. */
  hl: string | null;
  /** Cursor distance, metres from the line; null when none is set. */
  cursorM: number | null;
};

export type LapRef = {id: string; lapNumber: number | null};

/** What Race writes back: the cursor, and the highlighted lap when it changed. */
export type SelectionPatch = {hl: string | null; cursorM: number};

/**
 * Race time for the URL's cursor: on the highlighted lap, else the reference
 * (first selected) lap. Null when the URL has no cursor or the lap is not one
 * the player drove in this field (an old lap doc without a lap number).
 */
export function raceTimeFor(
  selection: RaceSelection,
  laps: LapRef[],
  clock: RaceClock,
): number | null {
  const lapId = selection.hl ?? selection.laps[0];
  const lap = laps.find(l => l.id === lapId);
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
