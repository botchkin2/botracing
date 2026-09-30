import {type CarState, type RaceCar} from '@/src/analysis/raceState';
import {formatRaceGap} from '@/src/design';

// The Race screen's model (handoff R1): the leaderboard rows and the map dots
// at one moment. Pure: `RaceScreen` gathers the field and the clock, this
// turns cars into what is drawn.

export type ClassKey = 'hypercar' | 'lmp2' | 'gt3' | 'other';
export type ClassFilter = 'all' | ClassKey;

// Field order, top of the leaderboard down.
export const CLASS_ORDER: ClassKey[] = ['hypercar', 'lmp2', 'gt3', 'other'];
export const CLASS_TITLE: Record<ClassKey, string> = {
  hypercar: 'HYPERCAR',
  lmp2: 'LMP2',
  gt3: 'GT3',
  other: 'OTHER',
};
/** Short names for the class filter. */
export const CLASS_SHORT: Record<ClassKey, string> = {
  hypercar: 'HY',
  lmp2: 'P2',
  gt3: 'GT3',
  other: 'Other',
};

/** LMU's class strings ("Hyper", "LMP2", "GT3") to the three the design colours. */
export function classKey(carClass: string): ClassKey {
  const c = carClass.toLowerCase();
  if (c.startsWith('hyper')) return 'hypercar';
  if (c.startsWith('lmp2')) return 'lmp2';
  if (c.startsWith('gt3') || c.includes('gte')) return 'gt3';
  return 'other';
}

export type RaceRow = {
  index: number;
  key: ClassKey;
  /** Place in the class, "" in the garage. */
  position: string;
  model: string;
  /** "+3.412", "" for a leader, "—" in the garage. */
  gap: string;
  /** Pit stops so far, or the state that replaces it. */
  status: string;
  state: CarState;
  player: boolean;
  focused: boolean;
};

export type RaceGroup = {title: string | null; rows: RaceRow[]};

export type RaceDot = {
  index: number;
  key: ClassKey;
  state: CarState;
  player: boolean;
  focused: boolean;
  xM: number;
  zM: number;
  /** The car's class position, for the map label (R1e). */
  label: string;
  /** Label priority, lower first (R1e); see labelRank. */
  labelRank: number;
};

export type RaceModel = {
  groups: RaceGroup[];
  /** Draw order: the field, then the focused car, then you last (R1d). */
  dots: RaceDot[];
  /** The classes present, in order, for the filter. */
  classes: ClassKey[];
  /** The filter in effect: the wanted one if present, else All. */
  filter: ClassFilter;
  carCount: number;
  you: {key: ClassKey; model: string} | null;
  /** The focus chip's text: "Ferrari 296 GT3 · GT3 P5 · +3.412". */
  focusLabel: string | null;
};

// R1d: what replaces the pit count when it is not "running".
const STATUS: Record<CarState, string> = {
  running: '',
  pit: 'PIT',
  stopped: 'STOP',
  off: 'OFF',
  garage: 'GAR',
};

/** The class filter a session opens on: yours (R1a: "default = your class"). */
export function defaultFilter(cars: RaceCar[]): ClassFilter {
  const you = cars.find(c => c.player);
  return you ? classKey(you.carClass) : 'all';
}

function rowOf(car: RaceCar, focus: number | null): RaceRow {
  const garage = car.state === 'garage';
  return {
    index: car.index,
    key: classKey(car.carClass),
    position: garage ? '' : String(car.classPlace),
    model: car.vehicle ?? 'Unknown car',
    gap: garage ? '—' : car.gapS && car.gapS > 0 ? formatRaceGap(car.gapS) : '',
    status:
      car.state === 'running' && car.pits > 0
        ? String(car.pits)
        : STATUS[car.state],
    state: car.state,
    player: car.player,
    focused: car.index === focus,
  };
}

// Class order by place, the garage after everyone on the map.
function byRun(a: RaceCar, b: RaceCar): number {
  const ga = a.state === 'garage' ? 1 : 0;
  const gb = b.state === 'garage' ? 1 : 0;
  return ga - gb || a.classPlace - b.classPlace || a.place - b.place;
}

function focusText(car: RaceCar): string {
  const parts = [car.vehicle ?? 'Unknown car'];
  if (car.state === 'garage') {
    parts.push('in the garage');
  } else {
    parts.push(`${CLASS_TITLE[classKey(car.carClass)]} P${car.classPlace}`);
    if (car.gapS) parts.push(formatRaceGap(car.gapS));
  }
  return parts.join(' · ');
}

/**
 * Who gets a map label first (R1e): the focused car, you, the cars within
 * three places of you in your class, the class leaders, then the field in
 * overall order. The tier is the thousands, the overall place breaks ties.
 */
export function labelRank(
  car: RaceCar,
  you: RaceCar | undefined,
  focus: number | null,
): number {
  const tier =
    car.index === focus
      ? 0
      : car.player
      ? 1
      : you &&
        classKey(car.carClass) === classKey(you.carClass) &&
        Math.abs(car.classPlace - you.classPlace) <= 3
      ? 2
      : car.classPlace === 1
      ? 3
      : 4;
  return tier * 1000 + car.place;
}

export function buildRaceModel(input: {
  cars: RaceCar[];
  filter: ClassFilter;
  focus: number | null;
}): RaceModel {
  const {cars, focus} = input;
  const present = CLASS_ORDER.filter(k =>
    cars.some(c => classKey(c.carClass) === k),
  );
  const filter =
    input.filter !== 'all' && present.includes(input.filter)
      ? input.filter
      : 'all';
  const shown = filter === 'all' ? present : [filter];
  const groups: RaceGroup[] = shown.map(k => {
    const inClass = cars.filter(c => classKey(c.carClass) === k).sort(byRun);
    return {
      title:
        filter === 'all' ? `${CLASS_TITLE[k]} · ${inClass.length} CARS` : null,
      rows: inClass.map(c => rowOf(c, focus)),
    };
  });
  const youCar = cars.find(c => c.player);
  const dot = (c: RaceCar): RaceDot => ({
    index: c.index,
    key: classKey(c.carClass),
    state: c.state,
    player: c.player,
    focused: c.index === focus,
    xM: c.xM,
    zM: c.zM,
    label: String(c.classPlace),
    labelRank: labelRank(c, youCar, focus),
  });
  // A car in the garage is not on the map (R1d).
  const onMap = cars.filter(c => c.state !== 'garage');
  const rank = (c: RaceCar) => (c.player ? 2 : c.index === focus ? 1 : 0);
  const dots = [...onMap].sort((a, b) => rank(a) - rank(b)).map(dot);
  const you = cars.find(c => c.player);
  const focused = focus == null ? undefined : cars.find(c => c.index === focus);
  return {
    focusLabel: focused ? focusText(focused) : null,
    groups,
    dots,
    classes: present,
    filter,
    carCount: cars.length,
    you: you
      ? {key: classKey(you.carClass), model: you.vehicle ?? 'Unknown car'}
      : null,
  };
}
