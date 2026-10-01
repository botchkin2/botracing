import {paceClass, paceOf} from '@/src/analysis/classLaps';
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
/** Class names in running text (the road summary), as the rest of the app writes them. */
const CLASS_NAME: Record<ClassKey, string> = {
  hypercar: 'Hypercar',
  lmp2: 'LMP2',
  gt3: 'GT3',
  other: 'Other',
};
/** Short names for the class filter. */
export const CLASS_SHORT: Record<ClassKey, string> = {
  hypercar: 'HY',
  lmp2: 'P2',
  gt3: 'GT3',
  other: 'Other',
};

/**
 * LMU's class strings to the three the design colours. GTE takes the GT3
 * colour here; class timing keeps it apart (`paceClass`), so the parsing of
 * the sim's strings is in one place.
 */
export function classKey(carClass: string): ClassKey {
  const pace = paceClass(carClass);
  return pace === 'gte' ? 'gt3' : pace;
}

// LMU names a car's model with its class on the end ("Porsche 911 GT3 R
// LMGT3", "Chevrolet Corvette Z06 LMGT3.", "... AMR LMGT" cut at 30 characters),
// and the class is shown beside it. One place strips it for display.
const CLASS_SUFFIX = /\s+(LMGT3?|LMH|LMP2|LMDH|GTE|GT3)\.?$/i;

/** A car's model as shown: the class suffix off, "Unknown car" when there is none. */
export function displayModel(vehicle: string | null): string {
  // In the middle ("Ferrari 296 LMGT3 Evo") LMU's class code is the car's GT3.
  const name = (vehicle ?? '')
    .trim()
    .replace(CLASS_SUFFIX, '')
    .replace(/\bLMGT3\b/g, 'GT3');
  return name === '' ? 'Unknown car' : name;
}

/**
 * A race ranks its cars (class place, gap to the leader). Practice and
 * qualifying have no road position that means anything, so the field mode
 * shows what is true of the road instead: how far each car is from you, ahead
 * or behind (pit-wall thread 45 #1589, decision 2026-10-01).
 */
export type RaceMode = 'race' | 'field';

/**
 * Metres along the road from `you` to a car, positive ahead, in (-L/2, L/2]
 * for a track of length `trackM`; null in the garage or without a track
 * length. A lap-distance difference, so a car a lap down reads as near.
 */
export function roadOffsetM(
  car: Pick<RaceCar, 'lapDistM'>,
  you: Pick<RaceCar, 'lapDistM'>,
  trackM: number,
): number | null {
  if (!(trackM > 0) || Number.isNaN(car.lapDistM) || Number.isNaN(you.lapDistM))
    return null;
  const d = (((car.lapDistM - you.lapDistM) % trackM) + trackM) % trackM;
  return d > trackM / 2 ? d - trackM : d;
}

/** Below this a car is standing still, and a time to it is not a number. */
const MOVING_KMH = 5;
/** A faster class is "coming" only within this many seconds behind. */
export const COMING_WITHIN_S = 5;

/**
 * Seconds for a distance on the road: ahead, the distance over your own
 * speed (how long until you reach where it is now); behind, over that car's
 * speed (how long until it reaches this point). Null when the car that sets
 * the time stands still.
 */
export function roadGapS(
  car: Pick<RaceCar, 'speedKmh'>,
  you: Pick<RaceCar, 'speedKmh'>,
  metres: number,
): number | null {
  const kmh = metres >= 0 ? you.speedKmh : car.speedKmh;
  return kmh >= MOVING_KMH ? Math.abs(metres) / (kmh / 3.6) : null;
}

const signed = (v: number, text: string) => `${v < 0 ? '−' : '+'}${text}`;

export type RoadNeighbour = {
  key: ClassKey;
  metres: number;
  /** Null when the car that sets the time is standing still. */
  seconds: number | null;
};

/** The cars nearest you on the road, and the nearest faster-class car close behind. */
export type RoadSummary = {
  ahead: RoadNeighbour | null;
  behind: RoadNeighbour | null;
  /** The nearest car behind of a faster class than yours, within COMING_WITHIN_S; null when none is. */
  coming: RoadNeighbour | null;
};

/**
 * Cars on the road around you: cars in the pit lane or the garage are not on
 * it. Null without you on the road. `coming` is a faster class by `paceOf`'s
 * rank, so GT3 and GTE count as one class here.
 */
export function roadSummary(
  cars: RaceCar[],
  trackM: number,
): RoadSummary | null {
  const you = cars.find(c => c.player);
  if (!you || you.state === 'garage' || you.state === 'pit') return null;
  const mine = paceOf(you.carClass).rank;
  const around = cars.flatMap(c => {
    if (c.player || c.state === 'garage' || c.state === 'pit') return [];
    const m = roadOffsetM(c, you, trackM);
    return m === null
      ? []
      : [
          {
            key: classKey(c.carClass),
            metres: m,
            seconds: roadGapS(c, you, m),
            rank: paceOf(c.carClass).rank,
          },
        ];
  });
  type Near = (typeof around)[number];
  const nearest = (list: Near[]): RoadNeighbour | null => {
    if (list.length === 0) return null;
    const best = list.reduce((a, b) =>
      Math.abs(b.metres) < Math.abs(a.metres) ? b : a,
    );
    return {
      key: best.key,
      metres: Math.abs(best.metres),
      seconds: best.seconds,
    };
  };
  const behind = around.filter(c => c.metres < 0);
  return {
    ahead: nearest(around.filter(c => c.metres > 0)),
    behind: nearest(behind),
    coming: nearest(
      behind.filter(
        c =>
          c.rank > mine && c.seconds !== null && c.seconds <= COMING_WITHIN_S,
      ),
    ),
  };
}

/** "1.5 s (120 m)", or "120 m" when the time is not known. */
const distanceText = (n: RoadNeighbour): string =>
  n.seconds === null
    ? `${Math.round(n.metres)} m`
    : `${n.seconds.toFixed(1)} s (${Math.round(n.metres)} m)`;

/** "Ahead 1.5 s (120 m) GT3 · Behind 1.0 s (85 m) LMP2 · Faster class: HYPERCAR 2.4 s (310 m) behind". */
export function roadSummaryText(s: RoadSummary): string {
  // When the car right behind is the faster class, it is one fact, not two.
  const sameCar =
    s.coming != null &&
    s.behind != null &&
    s.coming.key === s.behind.key &&
    s.coming.metres === s.behind.metres;
  const one = (label: string, n: RoadNeighbour | null, note = '') =>
    n ? [`${label} ${distanceText(n)} ${CLASS_NAME[n.key]}${note}`] : [];
  const faster =
    s.coming && !sameCar
      ? [
          `Faster class: ${CLASS_NAME[s.coming.key]} ${distanceText(
            s.coming,
          )} behind`,
        ]
      : [];
  return [
    ...one('Ahead', s.ahead),
    ...one('Behind', s.behind, sameCar ? ' (faster class)' : ''),
    ...faster,
  ].join(' · ');
}

export type RaceRow = {
  index: number;
  key: ClassKey;
  /** Place in the class, "" in the garage and in the field mode. */
  position: string;
  model: string;
  /** "+3.412", "" for a leader, "—" in the garage; in the field mode the road gap from you ("+1.5 s", "−1.0 s"), "" for you. */
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
  /** Field mode only: who is near you on the road; null in a race or without you on it. */
  road: RoadSummary | null;
};

// R1d: what replaces the pit count when it is not "running".
const STATUS: Record<CarState, string> = {
  running: '',
  // In the pit lane now; the stops so far are the number (round 5, item 5).
  pit: 'IN',
  stopped: 'STOP',
  off: 'OFF',
  garage: 'GAR',
};

/** The class filter a session opens on: yours (R1a: "default = your class"). */
export function defaultFilter(cars: RaceCar[]): ClassFilter {
  const you = cars.find(c => c.player);
  return you ? classKey(you.carClass) : 'all';
}

/**
 * The gap to the class leader: "+3.412", "+1:04.2" from a minute, "+1 lap" once
 * the car is a whole lap of distance behind ("+2 laps"), "" for the leader.
 */
export function gapText(car: RaceCar): string {
  if (car.lapsDown > 0)
    return `+${car.lapsDown} ${car.lapsDown === 1 ? 'lap' : 'laps'}`;
  return car.gapS && car.gapS > 0 ? formatRaceGap(car.gapS) : '';
}

type Frame = {mode: RaceMode; you: RaceCar | undefined; trackM: number};

/** The row's gap column: the gap to the class leader in a race, in the field mode the road gap from you in seconds ("+1.5 s"), metres where the time is not known. */
function gapOf(car: RaceCar, frame: Frame): string {
  if (car.state === 'garage') return '—';
  if (frame.mode === 'race') return gapText(car);
  if (car.player || !frame.you) return '';
  const m = roadOffsetM(car, frame.you, frame.trackM);
  if (m === null) return '';
  const s = roadGapS(car, frame.you, m);
  return signed(
    m,
    s === null ? `${Math.abs(Math.round(m))} m` : `${s.toFixed(1)} s`,
  );
}

function rowOf(car: RaceCar, focus: number | null, frame: Frame): RaceRow {
  const garage = car.state === 'garage';
  return {
    index: car.index,
    key: classKey(car.carClass),
    position: garage || frame.mode === 'field' ? '' : String(car.classPlace),
    model: displayModel(car.vehicle),
    gap: gapOf(car, frame),
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

// Field mode: furthest ahead first, down to furthest behind, you among them;
// cars with no place on the road (the garage) last.
function byRoad(a: RaceCar, b: RaceCar, frame: Frame): number {
  const offset = (c: RaceCar) =>
    c.player || !frame.you ? 0 : roadOffsetM(c, frame.you, frame.trackM);
  const [oa, ob] = [offset(a), offset(b)];
  if (oa === null || ob === null)
    return (oa === null ? 1 : 0) - (ob === null ? 1 : 0);
  return ob - oa;
}

const byOrder = (a: RaceCar, b: RaceCar, frame: Frame): number =>
  frame.mode === 'race' ? byRun(a, b) : byRoad(a, b, frame);

function focusText(car: RaceCar, frame: Frame): string {
  const parts = [displayModel(car.vehicle)];
  if (car.state === 'garage') {
    parts.push('in the garage');
  } else if (frame.mode === 'field') {
    parts.push(CLASS_TITLE[classKey(car.carClass)]);
    const gap = gapOf(car, frame);
    if (gap) parts.push(gap);
  } else {
    parts.push(`${CLASS_TITLE[classKey(car.carClass)]} P${car.classPlace}`);
    const gap = gapText(car);
    if (gap) parts.push(gap);
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
  /** Race by default; the field mode drops places and gaps. */
  mode?: RaceMode;
  /** The track's length in metres, for the road offsets of the field mode. */
  trackM?: number;
}): RaceModel {
  const {cars, focus} = input;
  const frame: Frame = {
    mode: input.mode ?? 'race',
    you: cars.find(c => c.player),
    trackM: input.trackM ?? 0,
  };
  const present = CLASS_ORDER.filter(k =>
    cars.some(c => classKey(c.carClass) === k),
  );
  const filter =
    input.filter !== 'all' && present.includes(input.filter)
      ? input.filter
      : 'all';
  const shown = filter === 'all' ? present : [filter];
  const groups: RaceGroup[] = shown.map(k => {
    const inClass = cars
      .filter(c => classKey(c.carClass) === k)
      .sort((a, b) => byOrder(a, b, frame));
    return {
      title:
        filter === 'all'
          ? `${CLASS_TITLE[k]} · ${inClass.length} CARS`
          : `Class · ${CLASS_TITLE[k]}`,
      rows: inClass.map(c => rowOf(c, focus, frame)),
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
    // No road position outside a race: nothing to number a dot with.
    label: frame.mode === 'race' ? String(c.classPlace) : '',
    labelRank: labelRank(c, youCar, focus),
  });
  // A car in the garage is not on the map (R1d).
  const onMap = cars.filter(c => c.state !== 'garage');
  const rank = (c: RaceCar) => (c.player ? 2 : c.index === focus ? 1 : 0);
  const dots = [...onMap].sort((a, b) => rank(a) - rank(b)).map(dot);
  const you = cars.find(c => c.player);
  const focused = focus == null ? undefined : cars.find(c => c.index === focus);
  return {
    focusLabel: focused ? focusText(focused, frame) : null,
    road: frame.mode === 'field' ? roadSummary(cars, frame.trackM) : null,
    groups,
    dots,
    classes: present,
    filter,
    carCount: cars.length,
    you: you
      ? {key: classKey(you.carClass), model: displayModel(you.vehicle)}
      : null,
  };
}
