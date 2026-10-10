// Which laps are "on" in Corner: drawn in their own lap colour on the
// strips, the zoomed traces and the braking map. They live in the URL's
// `laps`, shared with Session and Compare (pit-wall thread 27 #624/#679).
// The default is the reference plus the best comparable lap. No cap: every
// ticked lap is drawn (#3635); taps go through src/state/lapSelection.

/**
 * The laps on, in colour order (0 = reference). With few laps shown
 * (individual mode) every lap is on.
 */
export function keyLapIds(input: {
  /** Laps drawn (the selection, or every comparable lap). */
  lapIds: string[];
  /** The URL's `laps`. */
  selected: string[];
  hl: string | null;
  bestLapId: string | null;
  individual: boolean;
}): string[] {
  const {lapIds, selected, hl, bestLapId, individual} = input;
  if (individual) return lapIds;
  if (selected.length >= 2) return selected;
  const ref = lapIds[0];
  const second = hl ?? (bestLapId !== ref ? bestLapId : null) ?? lapIds[1];
  return [...new Set([ref, second].filter((id): id is string => !!id))];
}
