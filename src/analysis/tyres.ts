// Per-lap tyre facts the uploader writes on each lap doc (tools/sessions/
// tyres.mjs, pit-wall thread 44 E5): one shape for the adapter and every screen
// that reads it, so the wheel order is never a position in an array. Plain
// TypeScript, no imports.

export type Wheel = 'FL' | 'FR' | 'RL' | 'RR';

export const WHEELS: readonly Wheel[] = ['FL', 'FR', 'RL', 'RR'];

/** One value per wheel; null for a dead sensor or a wheel with no channel. */
export type PerWheel = Record<Wheel, number | null>;

export type LapTyres = {
  /** The block's version (the uploader's `blockVersions.tyres`). */
  v: number;
  /** Wear at the end of the lap, % of a new tyre. */
  wearPct: PerWheel | null;
  /** Median hot pressure over the lap, outside the pit lane, kPa. */
  pressureKpa: PerWheel | null;
  /** Median temperature of the outer rubber layer, same samples, C. */
  rubberC: PerWheel | null;
  /** Median carcass temperature, same samples, C. */
  carcassC: PerWheel | null;
  /**
   * The wheels with a new tyre in the pit stop that ended during this lap
   * (a full set, one wheel, or none); null when the recording has no wear
   * channel. The next lap is the first on new tyres.
   */
  changed: Wheel[] | null;
};

function isWheel(v: unknown): v is Wheel {
  return v === 'FL' || v === 'FR' || v === 'RL' || v === 'RR';
}

function perWheel(v: unknown): PerWheel | null {
  if (v == null || typeof v !== 'object') return null;
  const x = v as Record<string, unknown>;
  const read = (k: Wheel) => {
    const n = x[k];
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  };
  return {FL: read('FL'), FR: read('FR'), RL: read('RL'), RR: read('RR')};
}

/** A lap doc's `tyres`; null when the lap has none (older analysis, no channels). */
export function toLapTyres(v: unknown): LapTyres | null {
  if (v == null || typeof v !== 'object') return null;
  const x = v as Record<string, unknown>;
  return {
    v: typeof x.v === 'number' ? x.v : 0,
    wearPct: perWheel(x.wearPct),
    pressureKpa: perWheel(x.pressureKpa),
    rubberC: perWheel(x.rubberC),
    carcassC: perWheel(x.carcassC),
    changed: Array.isArray(x.changed) ? x.changed.filter(isWheel) : null,
  };
}
