// The classes of one session's field, one rule for both sims (pit-wall thread
// 1 #3184 to #3186): which cars are a class, what it is called, and which of
// the three class colours it takes. Pure.
//
// A class is LMU's class name (Hypercar, LMP2, GT3; GTE runs with GT3 here) or
// iRacing's class id with its label (tools/sessions/irClasses.mjs). The
// classes are ranked by pace, the median of their clean field laps, and the
// colours go fastest first: class1, class2, class3, and `other` past three and
// for cars with no class. So a colour names a pace rank, not a class: GT3 is
// class1 on a GT3-only server and class3 behind GTP and LMP2. That is only
// readable because every place that shows a class colour shows its label too
// (the legend, the leaderboard headers, the Cars around rows); keep it so.
import {paceClass} from './classLaps';
import {type FieldCar} from './field';

export type ClassSlot = 'class1' | 'class2' | 'class3' | 'other';

export interface FieldClass {
  /** The class's identity in this session: "hypercar", "lmp2", "gt3", "ir:4029", or "other". */
  key: string;
  slot: ClassSlot;
  /** "Hypercar", "GTP", "Mazda MX-5 Cup +2". */
  label: string;
  /** The label for headers: "HYPERCAR", "GTP". */
  title: string;
  /** The filter chip's text: "HY", "P2", "GT3", "GTP". */
  short: string;
  /** 0 is the fastest; equal to the class's place in `ClassTable.list`. */
  rank: number;
  /** Median clean lap, seconds; null under MIN_PACE_LAPS laps. */
  paceS: number | null;
}

export interface ClassTable {
  /** Fastest first, the unranked after, `other` last. */
  list: FieldClass[];
  /** The class of a class key; `other` for a key the table does not know. */
  of: (key: string) => FieldClass;
}

/** Under this many clean laps a class is not ranked on pace (rake #3186). */
export const MIN_PACE_LAPS = 3;

const SLOTS: ClassSlot[] = ['class1', 'class2', 'class3'];

const LMU: Record<string, {label: string; short: string}> = {
  hypercar: {label: 'Hypercar', short: 'HY'},
  lmp2: {label: 'LMP2', short: 'P2'},
  gt3: {label: 'GT3', short: 'GT3'},
};

const OTHER = {key: 'other', label: 'Other', short: 'Other'};

/** A car's class key and label: iRacing's id, else LMU's name, else other. */
export function classOfCar(
  car: Pick<FieldCar, 'carClass' | 'classId' | 'classLabel'>,
): {key: string; label: string; short: string} {
  if (car.classId != null) {
    const label = car.classLabel || 'Other';
    return {
      key: `ir:${car.classId}`,
      label,
      short: label.length <= 5 ? label : `${label.slice(0, 4)}…`,
    };
  }
  const pace = paceClass(car.carClass);
  const lmu = pace === 'gte' ? 'gt3' : pace;
  return lmu in LMU ? {key: lmu, ...LMU[lmu]} : OTHER;
}

/**
 * Each car's laps as the field saw them: the seconds between two steps of its
 * laps counter, a lap that touched the pit lane left out.
 */
export function cleanLapsS(
  car: Pick<FieldCar, 'lapsDone' | 'inPits'>,
  timeS: ArrayLike<number>,
): number[] {
  const out: number[] = [];
  let prev = -1;
  let prevT = NaN;
  let pitted = false;
  for (let u = 0; u < car.lapsDone.length; u++) {
    const laps = car.lapsDone[u];
    if (laps < 0) continue;
    if (car.inPits[u] === 1) pitted = true;
    if (prev >= 0 && laps === prev + 1) {
      if (!pitted && Number.isFinite(prevT)) out.push(timeS[u] - prevT);
      pitted = car.inPits[u] === 1;
      prevT = timeS[u];
    } else if (laps !== prev) {
      // The first reading, or a jump: no lap to time from here.
      prevT = timeS[u];
      pitted = car.inPits[u] === 1;
    }
    prev = laps;
  }
  return out;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * The session's classes, fastest first. A class with fewer than
 * MIN_PACE_LAPS clean laps can't be ranked on pace: it goes after the ranked
 * ones, by its best lap (none last). Cars with no class are `other`, always
 * last and grey.
 */
export function fieldClasses(field: {
  timeS: ArrayLike<number>;
  cars: Pick<
    FieldCar,
    'carClass' | 'classId' | 'classLabel' | 'lapsDone' | 'inPits'
  >[];
}): ClassTable {
  const seen = new Map<
    string,
    {key: string; label: string; short: string; laps: number[]}
  >();
  for (const car of field.cars) {
    const c = classOfCar(car);
    const entry = seen.get(c.key) ?? {...c, laps: []};
    entry.laps.push(...cleanLapsS(car, field.timeS));
    seen.set(c.key, entry);
  }
  const all = [...seen.values()];
  const named = all.filter(c => c.key !== OTHER.key);
  const best = (laps: number[]) => (laps.length ? Math.min(...laps) : Infinity);
  const ranked = named
    .filter(c => c.laps.length >= MIN_PACE_LAPS)
    .map(c => ({...c, paceS: median(c.laps)}))
    .sort((a, b) => (a.paceS as number) - (b.paceS as number));
  const unranked = named
    .filter(c => c.laps.length < MIN_PACE_LAPS)
    .sort((a, b) => best(a.laps) - best(b.laps))
    .map(c => ({...c, paceS: null}));
  const others = all
    .filter(c => c.key === OTHER.key)
    .map(c => ({...c, paceS: null}));
  const list: FieldClass[] = [...ranked, ...unranked, ...others].map(
    (c, rank) => ({
      key: c.key,
      slot: c.key === OTHER.key ? 'other' : SLOTS[rank] ?? 'other',
      label: c.label,
      title: c.label.toUpperCase(),
      short: c.short,
      rank,
      paceS: c.paceS,
    }),
  );
  const byKey = new Map(list.map(c => [c.key, c]));
  const fallback: FieldClass = {
    ...OTHER,
    slot: 'other',
    title: 'OTHER',
    rank: list.length,
    paceS: null,
  };
  return {list, of: key => byKey.get(key) ?? fallback};
}
