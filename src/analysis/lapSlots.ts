// Which lap a screen means, and the colour slot it gets, decided by meaning and
// never by where the lap sits in a list (brief gap 6: Corner's reference had
// become whichever lap came first). Three words, used by every screen:
//
//   Ref     the lap the user picked on purpose (URL `ref`); the only lap that
//           is "the reference", and the only one with colour slot 0;
//   best    the fastest timed lap of the set, the stand-in where a screen needs
//           one lap to read geometry or a clock from and no Ref is picked;
//   the set the checked laps, measured against their own median.
//
// The URL's `laps` order carries no meaning (state/lapSelection.ts), so slots
// follow lap-number order. Pure, no imports.

export type SlotLap = {id: string; lapIndex: number};

/**
 * Colour slots: the Ref lap is 0, every other lap follows in lap-number order
 * from 1, so without a Ref the first lap of the set is slot 1. Laps of another
 * session (`foreign`, Compare only) come after this session's, then by number;
 * ties keep the order they were given in.
 */
export function lapSlots(
  laps: readonly SlotLap[],
  refId: string | null | undefined,
  foreign: ReadonlySet<string> = new Set(),
): Map<string, number> {
  const ordered = laps
    .map((l, at) => ({l, at}))
    .sort(
      (a, b) =>
        Number(foreign.has(a.l.id)) - Number(foreign.has(b.l.id)) ||
        a.l.lapIndex - b.l.lapIndex ||
        a.at - b.at,
    )
    .map(x => x.l);
  const slots = new Map<string, number>();
  let next = 1;
  for (const l of ordered) {
    if (l.id === refId) slots.set(l.id, 0);
    else slots.set(l.id, next++);
  }
  return slots;
}

/** The fastest timed lap of the laps given (first on a tie), else null. */
export function bestLapOf<T extends {id: string; timeS: number | null}>(
  laps: readonly T[],
): T | null {
  let best: T | null = null;
  for (const l of laps) {
    if (l.timeS == null) continue;
    if (best == null || l.timeS < (best.timeS as number)) best = l;
  }
  return best;
}

/**
 * The one lap a screen reads geometry or a clock from: the Ref lap when it is
 * in the set, else the set's best lap, else the lowest-numbered lap (a set with
 * no timed lap). Never "the first in the list".
 */
export function anchorLapOf<
  T extends {id: string; lapIndex: number; timeS: number | null},
>(laps: readonly T[], refId: string | null | undefined): T | null {
  const ref = refId ? laps.find(l => l.id === refId) : undefined;
  if (ref) return ref;
  const best = bestLapOf(laps);
  if (best) return best;
  let lowest: T | null = null;
  for (const l of laps) if (lowest == null || l.lapIndex < lowest.lapIndex) lowest = l;
  return lowest;
}

/** The lap of a session that was driven first: the lowest lap number, whatever the list's order. */
export function firstLapOf<T extends {lapIndex: number}>(
  laps: readonly T[],
): T | null {
  let first: T | null = null;
  for (const l of laps) if (first == null || l.lapIndex < first.lapIndex) first = l;
  return first;
}
