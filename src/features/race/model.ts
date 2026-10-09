import {
  type ClassSlot,
  type ClassTable,
  type FieldClass,
} from '@/src/analysis/fieldClasses';
import {type CarState, type RaceCar} from '@/src/analysis/raceState';
import {formatRaceGap} from '@/src/design';

// The Race screen's model (handoff R1): the leaderboard rows and the map dots
// at one moment. Pure: `RaceScreen` gathers the field and the clock, this
// turns cars into what is drawn. Classes, their order, names and colours come
// from the session's class table (analysis/fieldClasses.ts), one rule for LMU
// and iRacing.

/** 'nearby' (field mode): every class, the cars within NEARBY_S of you on the road; else a class key. */
export type ClassFilter = 'all' | 'nearby' | string;

/** The Nearby filter's reach, seconds along the road either way (apex, thread 44 #1822). */
export const NEARBY_S = 10;
/** Where a time is not known (the car that sets it stands still), metres instead. */
export const NEARBY_STILL_M = 150;

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
  cls: FieldClass;
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
 * it. Null without you on the road. `coming` is a class ranked faster than
 * yours in the session's class table; a class not ranked on pace, and cars
 * with no class, are never `coming`.
 */
export function roadSummary(
  cars: RaceCar[],
  trackM: number,
  classes: ClassTable,
): RoadSummary | null {
  const you = cars.find(c => c.player);
  if (!you || you.state === 'garage' || you.state === 'pit') return null;
  const mine = classes.of(you.classKey);
  const around = cars.flatMap(c => {
    if (c.player || c.state === 'garage' || c.state === 'pit') return [];
    const m = roadOffsetM(c, you, trackM);
    const cls = classes.of(c.classKey);
    return m === null
      ? []
      : [
          {
            cls,
            metres: m,
            seconds: roadGapS(c, you, m),
            faster: cls.paceS != null && cls.rank < mine.rank,
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
      cls: best.cls,
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
        c => c.faster && c.seconds !== null && c.seconds <= COMING_WITHIN_S,
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
    s.coming.cls.key === s.behind.cls.key &&
    s.coming.metres === s.behind.metres;
  const one = (label: string, n: RoadNeighbour | null, note = '') =>
    n ? [`${label} ${distanceText(n)} ${n.cls.label}${note}`] : [];
  const faster =
    s.coming && !sameCar
      ? [`Faster class: ${s.coming.cls.label} ${distanceText(s.coming)} behind`]
      : [];
  return [
    ...one('Ahead', s.ahead),
    ...one('Behind', s.behind, sameCar ? ' (faster class)' : ''),
    ...faster,
  ].join(' · ');
}

export type RaceRow = {
  index: number;
  /** The class colour (fieldClasses.ts). */
  slot: ClassSlot;
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
  slot: ClassSlot;
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
  /** The classes present, fastest first, for the filter and the legend. */
  classes: FieldClass[];
  /** The filter in effect: the wanted one if present, else All. */
  filter: ClassFilter;
  carCount: number;
  you: {cls: FieldClass; model: string} | null;
  /** The focus chip's text: "Ferrari 296 GT3 · GT3 P5 · +3.412". */
  focusLabel: string | null;
  /** Field mode only: who is near you on the road; null in a race or without you on it. */
  road: RoadSummary | null;
  /** Why All is shown where Nearby was asked for: you are not on the road; null otherwise. */
  fallbackNote: string | null;
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

/**
 * The class filter a session opens on: yours (R1a: "default = your class"). On
 * the phone outside a race, Nearby always: it does not flip with the pit lane
 * as you go in and out, and the model says why when it cannot list the road
 * (`RaceModel.fallbackNote`).
 */
export function defaultFilter(
  cars: RaceCar[],
  opts: {nearby?: boolean} = {},
): ClassFilter {
  if (opts.nearby) return 'nearby';
  const you = cars.find(c => c.player);
  return you ? you.classKey : 'all';
}

/** Why the road list is not available: where you are instead. */
function notOnRoad(you: RaceCar | undefined): string {
  if (!you) return 'No car of yours in the field · all cars';
  return you.state === 'pit'
    ? 'You are in the pit lane · all cars'
    : 'You are in the garage · all cars';
}

/** Whether a car is on the road within Nearby's reach of you. Pit-lane and garage cars are not on the road. */
function isNearby(car: RaceCar, frame: Frame): boolean {
  if (car.player) return true;
  const you = frame.you;
  if (!you || car.state === 'garage' || car.state === 'pit') return false;
  const m = roadOffsetM(car, you, frame.trackM);
  if (m === null) return false;
  const s = roadGapS(car, you, m);
  return s === null ? Math.abs(m) <= NEARBY_STILL_M : s <= NEARBY_S;
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

type Frame = {
  mode: RaceMode;
  you: RaceCar | undefined;
  trackM: number;
  classes: ClassTable;
};

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
    slot: frame.classes.of(car.classKey).slot,
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
    parts.push(frame.classes.of(car.classKey).title);
    const gap = gapOf(car, frame);
    if (gap) parts.push(gap);
  } else {
    parts.push(`${frame.classes.of(car.classKey).title} P${car.classPlace}`);
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
        car.classKey === you.classKey &&
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
  /** The session's classes (fieldClasses), built once per field. */
  classes: ClassTable;
}): RaceModel {
  const {cars, focus} = input;
  const frame: Frame = {
    mode: input.mode ?? 'race',
    you: cars.find(c => c.player),
    trackM: input.trackM ?? 0,
    classes: input.classes,
  };
  const present = input.classes.list.filter(k =>
    cars.some(c => c.classKey === k.key),
  );
  // Nearby needs the field mode and you on the road; otherwise All.
  const nearbyOk =
    frame.mode === 'field' &&
    frame.you != null &&
    frame.you.state !== 'garage' &&
    frame.you.state !== 'pit';
  const filter =
    input.filter === 'nearby'
      ? nearbyOk
        ? 'nearby'
        : 'all'
      : input.filter !== 'all' && present.some(k => k.key === input.filter)
      ? input.filter
      : 'all';
  const near = cars
    .filter(c => isNearby(c, frame))
    .sort((a, b) => byOrder(a, b, frame));
  const nearOthers = near.filter(c => !c.player).length;
  const nearGroup: RaceGroup = {
    title: `Within ${NEARBY_S} s of you · ${nearOthers} CARS + YOU`,
    rows: near.map(c => rowOf(c, focus, frame)),
  };
  const shown =
    filter === 'all'
      ? present
      : filter === 'nearby'
      ? []
      : present.filter(k => k.key === filter);
  const classGroups: RaceGroup[] = shown.map(k => {
    const inClass = cars
      .filter(c => c.classKey === k.key)
      .sort((a, b) => byOrder(a, b, frame));
    return {
      title:
        filter === 'all'
          ? `${k.title} · ${inClass.length} CARS`
          : `Class · ${k.title}`,
      rows: inClass.map(c => rowOf(c, focus, frame)),
    };
  });
  const groups = filter === 'nearby' ? [nearGroup] : classGroups;
  const youCar = cars.find(c => c.player);
  const dot = (c: RaceCar): RaceDot => ({
    index: c.index,
    slot: input.classes.of(c.classKey).slot,
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
    road:
      frame.mode === 'field'
        ? roadSummary(cars, frame.trackM, input.classes)
        : null,
    fallbackNote:
      input.filter === 'nearby' && frame.mode === 'field' && !nearbyOk
        ? notOnRoad(frame.you)
        : null,
    groups,
    dots,
    classes: present,
    filter,
    carCount: cars.length,
    you: you
      ? {cls: input.classes.of(you.classKey), model: displayModel(you.vehicle)}
      : null,
  };
}
