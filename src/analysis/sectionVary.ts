// Which section he varies most in, in seconds (pit-wall thread 110, ticket 44). Each section's spread is the IQR of
// the basis laps' times in it, the one spread the app shows (setStats.ts); a section whose window the lap left with
// wheels off has no time on that lap, so it is counted apart and never dropped silently. A session with fewer than
// MIN_SPREAD_LAPS laps in a section borrows his earlier sessions at the same track and car: each lap becomes its
// offset from its own session's median in that section (a hotter day or a heavier car moves a session's whole
// column, not its spread), and a session joins a section only with MIN_POOLED_SESSION_LAPS laps there (a session
// of one lap is its own median and would lower the spread). Pure; no imports beyond setStats and spreadShare.
import {iqr, median, sortedFinite, type Sample} from './setStats.ts';
import {MIN_SPREAD_LAPS} from './spreadShare.ts';

/** A session joins a section's pool only with this many counted laps there: with fewer its median is the lap itself. */
export const MIN_POOLED_SESSION_LAPS = 3;
/** A section is named for its wheels-off laps, ahead of the seconds, from this many laps... */
export const OFFS_FIRST_LAPS = 3;
/** ...and from this share of the session's counted-plus-off laps there, so 3 laps of 40 and 3 laps of 10 do not read alike. */
export const OFFS_FIRST_SHARE = 0.2;

/** One lap's time in each section (null where it does not count) and whether the window was left with wheels off. */
export interface VaryLap {
  timesS: readonly Sample[];
  /** Per section: true where the window was excluded for being off track (not for the pit lane). */
  offs?: readonly boolean[];
}

/** An earlier session of the same track and car, its basis laps; `startedAt` (ISO) names it in the laps line ("Oct 19"). */
export interface PooledSession {
  startedAt: string;
  laps: readonly VaryLap[];
}

export interface VaryRow {
  /** The section's index among the columns. */
  index: number;
  /** The IQR in seconds; null for a section named for its wheels-off laps that has too few laps for a spread. */
  spreadS: number | null;
  /** This session's laps with wheels off in the section. */
  offLaps: number;
  /** This session's laps that count there plus those with wheels off: the "of 12". */
  ownLaps: number;
  /** Laps the spread rests on (this session's, or pooled). */
  n: number;
  /** True when the spread rests on offsets pooled with earlier sessions. */
  pooled: boolean;
  /** Named for wheels-off laps ahead of the seconds. */
  offsFirst: boolean;
}

export interface SectionVary {
  /** Sections with wheels off on many laps first (most offs first), then by seconds, biggest first. */
  rows: VaryRow[];
  /** This session's basis laps. */
  ownLaps: number;
  /** Laps of the earlier sessions that joined at least one section. */
  pooledLaps: number;
  /** When those sessions started (ISO), in the order given. */
  pooledFrom: string[];
}

const counted = (laps: readonly VaryLap[], i: number): number[] =>
  sortedFinite(laps.map(l => l.timesS[i]));

const offsetsFrom = (times: readonly number[], m: number): number[] =>
  times.map(t => t - m);

/**
 * The sections ranked by how much he varies in them; null when no section reaches MIN_SPREAD_LAPS laps even pooled
 * (then the screen says how many laps it has). `others` are the earlier sessions already collapsed to one per run
 * (twinRuns.ts) and inside the window; this never fetches or filters them.
 */
export function sectionVary(
  own: readonly VaryLap[],
  others: readonly PooledSession[],
  sections: number,
): SectionVary | null {
  const rows: VaryRow[] = [];
  const joined = new Set<number>();
  for (let i = 0; i < sections; i++) {
    const mine = counted(own, i);
    const off = own.filter(l => l.offs?.[i] === true).length;
    let pool: number[] = mine;
    let pooled = false;
    if (mine.length < MIN_SPREAD_LAPS) {
      pool = [];
      const m = median(mine);
      if (m != null && mine.length >= MIN_POOLED_SESSION_LAPS)
        pool.push(...offsetsFrom(mine, m));
      others.forEach((s, k) => {
        const theirs = counted(s.laps, i);
        const tm = median(theirs);
        if (tm == null || theirs.length < MIN_POOLED_SESSION_LAPS) return;
        pool.push(...offsetsFrom(theirs, tm));
        pooled = true;
        joined.add(k);
      });
    }
    const spreadS = pool.length >= MIN_SPREAD_LAPS ? iqr(pool) : null;
    const offsFirst =
      off >= OFFS_FIRST_LAPS && off / (mine.length + off) >= OFFS_FIRST_SHARE;
    if (spreadS == null && !offsFirst) continue;
    rows.push({
      index: i,
      spreadS,
      offLaps: off,
      ownLaps: mine.length + off,
      n: pool.length,
      pooled,
      offsFirst,
    });
  }
  if (!rows.some(r => r.spreadS != null)) return null;
  rows.sort((a, b) => {
    if (a.offsFirst !== b.offsFirst)
      return Number(b.offsFirst) - Number(a.offsFirst);
    if (a.offsFirst) return b.offLaps - a.offLaps || a.index - b.index;
    return (b.spreadS ?? 0) - (a.spreadS ?? 0) || a.index - b.index;
  });
  const used = [...joined].sort((a, b) => a - b).map(k => others[k]);
  return {
    rows,
    ownLaps: own.length,
    pooledLaps: used.reduce((t, s) => t + s.laps.length, 0),
    pooledFrom: used.map(s => s.startedAt),
  };
}
