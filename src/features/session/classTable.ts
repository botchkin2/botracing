import {PACE_RANK, type PaceClass} from '@/src/analysis/classLaps';
import {type SessionClassBests} from '@/src/data/sessions';
import {carLabel} from '@/src/design/carModels';

// The Session head's class table (pit-wall thread 1 #4637 to #4645): the
// fastest cars of each class in this session, from the recorded field. One row
// per class: its best, its fifth-fastest car (a real car's lap, not a blend),
// and how many cars. A row unfolds to every car by best lap. Facts only: no
// names or numbers exist in the field, and the times are the field's own lap
// clock (1 to 3 ms from the player's real lap times on three races).
// Pure: the component only draws it.

/** A class's name as the app shows it everywhere (Plan's class timing). */
const LABELS: Record<PaceClass, string> = {
  hypercar: 'Hypercar',
  lmp2: 'LMP2',
  gt3: 'GT3',
  gte: 'GTE',
  other: 'Other',
};

/**
 * The class LMU appends to a field car's model ("BMW M4 LMGT3", "Ferrari 296
 * LMGT3 Evo", "Aston Martin Valkyrie LMH"): dropped, since the row already sits under its class and a 375
 * column cuts the name otherwise.
 */
const CLASS_TOKEN = /\s+LM(?:GT3|GTE|P2|P3|H|DH)\b/i;

/** A field car's name: the app's car-name rule, then without its class. */
export const fieldCarName = (vehicle: string) =>
  carLabel(vehicle).model.replace(CLASS_TOKEN, '').trim();

/** The fifth-fastest car stands for the front of a class; with fewer cars, the last one. */
const FRONT_CARS = 5;

export type ClassEntry = {
  /** Position in the class by best lap, from 1. */
  rank: number;
  /** The car model as the app names cars (carLabel), without its class; null when the recorder had none. */
  car: string | null;
  bestS: number;
  /** Seconds behind the class's fastest car; 0 for the fastest. */
  gapS: number;
  player: boolean;
};

export type ClassRow = {
  key: PaceClass;
  label: string;
  bestS: number;
  /** The fifth-fastest car's best, or the last car's when the class has fewer than five. */
  fifthS: number;
  cars: number;
  /** The player's own best and place in this class; null in every other row. */
  mine: {bestS: number; rank: number} | null;
  entries: ClassEntry[];
};

export type ClassTable = {rows: ClassRow[]};

/**
 * The table, or null with nothing to compare against: no block, or only one
 * car in the whole field (a practice alone). The player's class is first,
 * the others by pace, fastest class first.
 */
export function classTable(
  b: SessionClassBests | null,
  officialBestS: number | null = null,
): ClassTable | null {
  if (!b) return null;
  const keys = (Object.keys(b.classes) as PaceClass[]).filter(
    k => b.classes[k] != null,
  );
  const total = keys.reduce(
    (n, k) => n + (b.classes[k]?.bestsS.length ?? 0),
    0,
  );
  if (keys.length === 0 || total < 2) return null;
  const rows = keys.map((key): ClassRow => {
    const c = b.classes[key]!;
    const best = c.bestsS[0];
    const cars = c.bestsS.length;
    const entries = c.bestsS.map((fieldS, i): ClassEntry => {
      // The player's own lap is the one time the rest of the app shows (the head's
      // Best, the official lap), never the field's clock 1 ms away from it; the
      // other cars, and every rank and gap to a class best, stay on the field clock.
      const bestS =
        c.player === i && officialBestS != null ? officialBestS : fieldS;
      const at = c.vehicleAt[i];
      const vehicle = at >= 0 ? b.vehicles[at] ?? null : null;
      return {
        rank: i + 1,
        car: vehicle ? fieldCarName(vehicle) : null,
        bestS,
        gapS: bestS - best,
        player: c.player === i,
      };
    });
    return {
      key,
      label: LABELS[key],
      // From the entries, so the player's own lap reads the same wherever it is.
      bestS: entries[0].bestS,
      fifthS: entries[Math.min(FRONT_CARS, cars) - 1].bestS,
      cars,
      mine:
        c.player != null
          ? {
              bestS: officialBestS ?? c.bestsS[c.player],
              rank: c.player + 1,
            }
          : null,
      entries,
    };
  });
  rows.sort(
    (a, b2) =>
      Number(b2.mine != null) - Number(a.mine != null) ||
      PACE_RANK[b2.key] - PACE_RANK[a.key],
  );
  return {rows};
}
