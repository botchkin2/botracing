import {type GridTrace, gridIndex} from '@/src/analysis/resample';

// The time difference to the reference through one turn, zero at the turn's
// entry (apex #947): the whole-lap gap is what Compare shows; here only what
// this stretch adds or takes back counts. It is the grid time difference
// (`timeS` of the two traces on the shared grid) minus its value at the entry,
// so no new interpolation happens.

/**
 * `lap.timeS - ref.timeS` at every grid point, minus the same at `entryM`.
 * Positive = slower than the reference since the entry. Empty when either
 * trace is missing; the reference against itself is 0 throughout.
 */
export function deltaFromEntry(
  lap: GridTrace | undefined,
  ref: GridTrace | undefined,
  entryM: number,
): number[] {
  if (!lap || !ref) return [];
  const n = Math.min(lap.timeS.length, ref.timeS.length);
  if (n === 0) return [];
  const entry = Math.min(n - 1, gridIndex(lap, Math.max(0, entryM)));
  const atEntry = lap.timeS[entry] - ref.timeS[entry];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(lap.timeS[i] - ref.timeS[i] - atEntry);
  return out;
}
