// Which laps are "on" in Corner: drawn in their own lap colour on the
// strips, the zoomed traces and the braking map. They live in the URL's
// `laps`, shared with Session and Compare (pit-wall thread 27 #624/#679).
// With one lap ticked or none, the default is that lap (or the session's best)
// plus the highlighted lap or the next fastest. No cap: every ticked lap is
// drawn (#3635); taps go through src/state/lapSelection. Their order carries no
// meaning; colours come from analysis/lapSlots.ts (Ref 0, the rest by lap number).

/**
 * The laps that are on. With few laps shown (individual mode) every lap is on.
 */
export function keyLapIds(input: {
  /** Laps drawn (the selection, or every comparable lap). */
  lapIds: string[];
  /** The URL's `laps`. */
  selected: string[];
  hl: string | null;
  bestLapId: string | null;
  /** The laps drawn, fastest first: where "the best" and "the next" come from. */
  ranked?: string[];
  individual: boolean;
}): string[] {
  const {lapIds, selected, hl, bestLapId, individual} = input;
  if (individual) return lapIds;
  if (selected.length >= 2) return selected;
  const ranked = (input.ranked ?? lapIds).filter(id => lapIds.includes(id));
  const best = bestLapId && lapIds.includes(bestLapId) ? bestLapId : ranked[0];
  // The one ticked lap, else the session's best.
  const first = selected[0] ?? best;
  const second =
    (hl && lapIds.includes(hl) && hl !== first ? hl : null) ??
    (best && best !== first ? best : null) ??
    ranked.find(id => id !== first);
  return [...new Set([first, second].filter((id): id is string => !!id))];
}

/**
 * "Reset": back to the session's opening set (openingLapIds, the one Session
 * and Compare open on), with the picked Ref kept in it.
 */
export function resetLapIds(
  refId: string | null | undefined,
  openingIds: string[],
): string[] {
  return refId && !openingIds.includes(refId)
    ? [refId, ...openingIds]
    : openingIds;
}
