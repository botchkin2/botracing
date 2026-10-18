// A sitting: the same driver's sessions of one track layout, car and type run
// back to back, which the app counts as one set of laps (pit-wall thread 88,
// chord's day set #5950/#5953). Not a calendar day: his evenings cross
// midnight UTC and a device-local date moves with the phone (gauge #5952).
// Pure; no imports.

/**
 * A session starting within this long of the previous one's end joins its
 * sitting. 3 h from his 357 consecutive same track, car and type pairs (prod,
 * 2026-10-18, chord #5953), by gap: up to 15 min 84, 15-30 min 8, 30-60 min
 * 44, 1-2 h 10, **2-12 h 1**, 12-24 h 119, 24-48 h 30, over 48 h 61. The
 * valley is empty, so a few minutes either way changes nothing.
 */
export const SITTING_GAP_MS = 3 * 60 * 60 * 1000;

export interface SittingItem {
  id: string;
  trackId: string;
  /** The car without its livery (carLabel(car).model). */
  carModel: string;
  /** 'P' or 'Q' sit together; a race ('R') is its own event and never joins. */
  sessionType: string;
  startedAt: string;
  /** Null when the session has no end stored: it is treated as ending where it started. */
  endedAt: string | null;
}

const MERGES = new Set(['P', 'Q']);

/**
 * The sittings of two or more sessions, each in start order, oldest sitting
 * first. A race, a session alone, and one with an unreadable start give none.
 */
export function sittings<T extends SittingItem>(items: readonly T[]): T[][] {
  const byKey = new Map<string, T[]>();
  for (const s of items) {
    if (!MERGES.has(s.sessionType) || !Number.isFinite(Date.parse(s.startedAt)))
      continue;
    const key = `${s.trackId}|${s.carModel}|${s.sessionType}`;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(s);
  }
  const out: T[][] = [];
  for (const group of byKey.values()) {
    group.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    let run: T[] = [];
    let endMs = -Infinity;
    for (const s of group) {
      const start = Date.parse(s.startedAt);
      if (run.length > 0 && start - endMs > SITTING_GAP_MS) {
        if (run.length > 1) out.push(run);
        run = [];
        endMs = -Infinity;
      }
      run.push(s);
      const end = s.endedAt == null ? NaN : Date.parse(s.endedAt);
      endMs = Math.max(endMs, Number.isFinite(end) ? end : start);
    }
    if (run.length > 1) out.push(run);
  }
  return out.sort(
    (a, b) => Date.parse(a[0].startedAt) - Date.parse(b[0].startedAt),
  );
}

/** The sitting a session is in, or null when it is alone. */
export function sittingOf<T extends SittingItem>(
  items: readonly T[],
  id: string,
): T[] | null {
  return sittings(items).find(set => set.some(s => s.id === id)) ?? null;
}
