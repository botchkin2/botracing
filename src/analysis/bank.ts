// The curated road bank (tools/curate plan-bank, the track map's `bank`) read at other distances. rollDeg[i] is the
// road's cross-slope in degrees at i * stepM metres of the map's lap, + with the right side of the direction of travel
// up. The profile is in the same distance frame as the height profile (elevation.ts). Plain TypeScript with erasable
// syntax only: Node can run it.

export type Bank = {stepM: number; rollDeg: readonly number[]};

/**
 * The bank at `m` metres on a lap of `lapM` metres, for a reader that goes round and round (the 3D chase). `m` wraps
 * into the lap; past the last point the roll runs on to the first over what is left of the lap, so there is no step at
 * the line.
 */
export function bankOnLap(b: Bank, m: number, lapM: number): number {
  const at = ((m % lapM) + lapM) % lapM;
  const last = b.rollDeg.length - 1;
  const lastM = last * b.stepM;
  if (at <= lastM) {
    const f = at / b.stepM;
    const i = Math.min(Math.floor(f), last);
    const next = Math.min(i + 1, last);
    return b.rollDeg[i] + (b.rollDeg[next] - b.rollDeg[i]) * (f - i);
  }
  const tail = lapM - lastM;
  const t = tail > 0 ? Math.min(1, (at - lastM) / tail) : 0;
  return b.rollDeg[last] + (b.rollDeg[0] - b.rollDeg[last]) * t;
}
