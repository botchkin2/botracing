// What moves with the time (pit-wall thread 88, S4): for the corner part on the
// screen, which of the driver's inputs tracks its time across the set's laps.
// Spearman's rho of each input with the part's window time, printed as a
// number and a bar; a row under the 5 % critical size for its n is dimmed.
// Pure; the model hands it one value per lap.

import {median, iqr} from '@/src/analysis/setStats';
import {spearman, spearmanCritical} from '@/src/analysis/rankCorrelation';

/** Under this many laps with a time the card is not drawn. */
export const MOVES_MIN_LAPS = 10;

export type MoveId = 'brake' | 'line' | 'steer' | 'throttle';

/** One lap's inputs for the part: metres are the model's own (brake: before the apex; throttle: after it). */
export type MovesLap = {
  time: number | null;
  brake: number | null;
  /** path_lateral_m at the slowest sample, signed as the sim stores it (LMU: right is positive). */
  lateral: number | null;
  /** Steering size at the slowest sample, % of lock. */
  steerPct: number | null;
  throttle: number | null;
  minSpeedKph: number | null;
};

export type MovesRow = {
  id: MoveId;
  label: string;
  rho: number;
  n: number;
  /** |rho| is under the two-sided 5 % critical value for n: what noise gives. */
  dimmed: boolean;
};

export type MovesCard = {
  /** Laps with a time. */
  n: number;
  /** The slowest sample's speed, as context, not as an input: it is the outcome. */
  apex: {kph: number; spreadKph: number} | null;
  rows: MovesRow[];
};

const LABEL: Record<MoveId, string> = {
  brake: 'Brake',
  line: 'Line',
  steer: 'Steer',
  throttle: 'Pedal',
};

/** Robust spread in the units of a standard deviation (IQR / 1.349), null under the spread floor. */
const sigmaOf = (v: readonly (number | null)[]) => {
  const q = iqr(v);
  return q == null ? null : q / 1.349;
};

/**
 * The card for a part, or null under MOVES_MIN_LAPS laps with a time, or when
 * no input has enough pairs to correlate. `direction` turns the signed line
 * into "metres toward the inside" so a sign means the same on every corner; a
 * part whose direction is mixed has no line row.
 */
export function buildMoves(
  laps: readonly MovesLap[],
  direction: 'left' | 'right' | 'mixed',
): MovesCard | null {
  const timed = laps.filter(l => l.time != null);
  if (timed.length < MOVES_MIN_LAPS) return null;
  const time = timed.map(l => l.time);
  const inside = (m: number | null) =>
    m == null || direction === 'mixed' ? null : direction === 'right' ? m : -m;
  const inputs: [MoveId, (number | null)[]][] = [
    ['brake', timed.map(l => l.brake)],
    ['line', timed.map(l => inside(l.lateral))],
    ['steer', timed.map(l => l.steerPct)],
    ['throttle', timed.map(l => l.throttle)],
  ];
  const rows: MovesRow[] = [];
  for (const [id, values] of inputs) {
    const r = spearman(values, time);
    const critical = r ? spearmanCritical(r.n) : null;
    if (!r || critical == null) continue;
    rows.push({
      id,
      label: LABEL[id],
      rho: r.rho,
      n: r.n,
      dimmed: Math.abs(r.rho) < critical,
    });
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
  const speeds = timed.map(l => l.minSpeedKph);
  const kph = median(speeds);
  return {
    n: timed.length,
    apex: kph == null ? null : {kph, spreadKph: sigmaOf(speeds) ?? 0},
    rows,
  };
}
