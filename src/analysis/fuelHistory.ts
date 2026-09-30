// Which of the driver's earlier laps the fuel planner should trust (pit wall
// thread 36, camber #1102). A balance-of-performance change moves fuel per lap
// (Barcelona 2026-08: 2.31 L and 3.33 % VE a lap in March and April, 2.88 L and
// 4.30 % from August), and a history that mixes the two plans the old car.
// Two guards: the caller keeps only sessions at the rules' fill limit, and
// `sinceChange` drops the laps from before a jump in use that the newest
// session shows.
//
// Plain TypeScript with erasable syntax only, no imports: Node can run it.

/** The fields of a green lap this reads; `GreenLap` in fuelPlan.ts has them. */
export interface HistoryLap {
  fuelL: number;
  vePct: number | null;
}

/** A session's green laps, in the order the caller gives the sessions: newest first. */
export interface HistorySession<L extends HistoryLap> {
  id: string;
  laps: L[];
}

/** How far the newest session's median may sit from the rest before it is a change. */
export const DRIFT_FRACTION = 0.1;
/** Fewer green laps in a session than this and it says nothing about drift (matches the planner). */
const MIN_LAPS = 3;
/** Two fill limits within this many litres are the same limit. */
export const SAME_LIMIT_L = 0.5;

/** Whether a session's limit is the wanted one; unknown never matches. */
export function sameLimit(limitL: number | null, wantedL: number): boolean {
  return limitL != null && Math.abs(limitL - wantedL) <= SAME_LIMIT_L;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

interface Medians {
  fuelL: number | null;
  vePct: number | null;
}

/** A session's median use per lap, null when it has fewer than MIN_LAPS laps with the value. */
function mediansOf(laps: HistoryLap[]): Medians {
  const fuel = laps.map(l => l.fuelL);
  const ve = laps.flatMap(l => (l.vePct != null ? [l.vePct] : []));
  return {
    fuelL: fuel.length >= MIN_LAPS ? median(fuel) : null,
    vePct: ve.length >= MIN_LAPS ? median(ve) : null,
  };
}

const off = (a: number | null, b: number | null): boolean =>
  a != null && b != null && b > 0 && Math.abs(a - b) / b > DRIFT_FRACTION;

/** One meter's newest-against-history medians, for the card's line. */
export interface DriftMeter {
  newest: number;
  history: number;
}

export interface HistoryDrift {
  /** Set for a meter that is more than DRIFT_FRACTION off; null for one that is not. */
  fuelL: DriftMeter | null;
  vePct: DriftMeter | null;
  /** Sessions and laps the plan keeps, and the older sessions it leaves out. */
  keptSessions: number;
  keptLaps: number;
  droppedSessions: number;
}

export interface DriftedHistory<L extends HistoryLap> {
  laps: L[];
  /** Ids of the sessions the laps come from. */
  sessionIds: string[];
  /** Null when the newest session is in line with the rest, or there is too little to compare. */
  drift: HistoryDrift | null;
}

/**
 * The laps to plan from. The newest session with enough laps is compared with
 * the pooled median of all the others; if fuel or VE per lap is more than
 * DRIFT_FRACTION off, the plan keeps that session and the run of sessions
 * before it that are in line with it, and stops at the first that is not.
 * Sessions with too few laps to judge do not end the run.
 */
export function sinceChange<L extends HistoryLap>(
  sessions: HistorySession<L>[],
): DriftedHistory<L> {
  const all = {
    laps: sessions.flatMap(s => s.laps),
    sessionIds: sessions.map(s => s.id),
    drift: null,
  };
  const per = sessions.map(s => mediansOf(s.laps));
  const at = per.findIndex(m => m.fuelL != null || m.vePct != null);
  if (at < 0) return all;
  const others = sessions.flatMap((s, i) => (i === at ? [] : s.laps));
  const pooled = mediansOf(others);
  const newest = per[at];
  const fuelOff = off(newest.fuelL, pooled.fuelL);
  const veOff = off(newest.vePct, pooled.vePct);
  if (!fuelOff && !veOff) return all;

  let end = at + 1;
  while (end < sessions.length) {
    const m = per[end];
    if (off(m.fuelL, newest.fuelL) || off(m.vePct, newest.vePct)) break;
    end++;
  }
  const kept = sessions.slice(0, end);
  const laps = kept.flatMap(s => s.laps);
  return {
    laps,
    sessionIds: kept.map(s => s.id),
    drift: {
      fuelL:
        fuelOff && newest.fuelL != null && pooled.fuelL != null
          ? {newest: newest.fuelL, history: pooled.fuelL}
          : null,
      vePct:
        veOff && newest.vePct != null && pooled.vePct != null
          ? {newest: newest.vePct, history: pooled.vePct}
          : null,
      keptSessions: kept.length,
      keptLaps: laps.length,
      droppedSessions: sessions.length - kept.length,
    },
  };
}
