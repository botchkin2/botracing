// Which laps are "on" in Corner: drawn in their own lap colour on the
// strips, the zoomed traces and the braking map. They live in the URL's
// `laps` (reference first), shared with Session and Compare (pit-wall
// thread 27 #624/#679). The default is the reference plus the best
// comparable lap. Tapping a dot adds or removes that lap, up to the lap
// palette.

// Reference plus five: the lap palette's size.
export const MAX_ON_LAPS = 6;

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
  if (selected.length >= 2 && selected.length <= MAX_ON_LAPS) return selected;
  const ref = lapIds[0];
  const second = hl ?? (bestLapId !== ref ? bestLapId : null) ?? lapIds[1];
  return [...new Set([ref, second].filter((id): id is string => !!id))];
}

export type ToggleResult =
  | {kind: 'ok'; laps: string[]}
  | {kind: 'full'}
  | {kind: 'reference'};

/** The URL's new `laps` after tapping a lap on a strip. */
export function toggleLap(on: string[], lapId: string): ToggleResult {
  if (on[0] === lapId) return {kind: 'reference'};
  if (on.includes(lapId))
    return {kind: 'ok', laps: on.filter(id => id !== lapId)};
  if (on.length >= MAX_ON_LAPS) return {kind: 'full'};
  return {kind: 'ok', laps: [...on, lapId]};
}
