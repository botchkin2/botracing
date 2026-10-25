// One real run recorded twice: the tray's live capture and LMU's .duckdb of the same drive (and the third doc a
// re-sync can leave, 10-15's 32c9d386 / 7e812df9 / c7ae92b3) are sessions of one track and car starting within a
// minute of each other. Counted apart, a run would be its own second source (the Plan's checks) or its own lap
// pool (the spread). The one rule both read. Pure; no imports.

/** Two docs of one run start within this many seconds of each other. */
export const TWIN_WINDOW_S = 60;

/** A session as the grouping reads it: `trackCar` is equal for sessions of one track and car. */
export type TwinCandidate = {startedAt: string; trackCar: string};

/** The sessions grouped by run, each group oldest first and the groups in start order. */
export function groupTwins<T extends TwinCandidate>(
  sessions: readonly T[],
): T[][] {
  const byStart = [...sessions].sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  );
  const groups: T[][] = [];
  for (const s of byStart) {
    const g = groups.find(
      x =>
        x[0].trackCar === s.trackCar &&
        Math.abs(Date.parse(s.startedAt) - Date.parse(x[0].startedAt)) <=
          TWIN_WINDOW_S * 1000,
    );
    if (g) g.push(s);
    else groups.push([s]);
  }
  return groups;
}
