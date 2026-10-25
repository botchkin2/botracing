// Other drivers' pace by class, from the game's results file (ticket 20, pit-wall
// thread 111, decision 2026-10-25-other-drivers-class-pace.md). The results
// input v2 (tools/sessions/resultsInput.mjs) carries every driver's laps with
// the game's three sector times; this folds them into the session doc's
// `classPace`: per driver the best and the median of the valid laps and of each
// sector. O(cars), not O(laps), so it rides on the full session doc and never in
// a list. Pure, erasable syntax only: the cloud analysis (Node) runs it.
//
// A valid lap is a timed lap: the file already reads `--.----` for a lap the
// game deleted (of 5,163 laps with a Warning, Cut or Off ruling over every driver
// in 471 files, 5,147 do; thread 111 #7513 point 4), so no ruling rule of our own.
// A sector counts when its lap is valid and the file gives it.
// No names and no car numbers: a row is "P3 · Porsche 911 GT3 R".
import {median} from './setStats.ts';

/** Bump when the rules below change: it is `blockVersions.classPace`, a stored one is made again. */
export const CLASS_PACE_VERSION = 1;

/** Fewest valid laps a driver's median is quoted for: under it the row shows the best only. */
export const MIN_PACE_LAPS = 3;

/** How many of the class's fastest cars the top line compares him to. */
export const TOP_CARS = 5;

/** One lap as the results input carries it; a time the file reads `--.----` or leaves out is null. */
export type ResultsLap = {
  t: number | null;
  s1: number | null;
  s2: number | null;
  s3: number | null;
  pit: boolean;
};

/** One driver of the results input v2; `player` is set on the PC, where the names are. */
export type ResultsDriver = {
  player: boolean;
  cls: string;
  car: string;
  pos: number | null;
  laps: ResultsLap[];
};

export type SectorPace = {best: number | null; median: number | null};

export type DriverPace = {
  cls: string;
  car: string;
  pos: number | null;
  /** He is this driver. */
  you: boolean;
  /** Valid laps. */
  laps: number;
  best: number | null;
  /** Null under MIN_PACE_LAPS valid laps. */
  median: number | null;
  /** S1, S2, S3. */
  sectors: [SectorPace, SectorPace, SectorPace];
};

export type ClassPaceDoc = {v: number; drivers: DriverPace[]};

const best = (values: number[]): number | null =>
  values.length ? Math.min(...values) : null;

const medianFrom = (values: number[]): number | null =>
  values.length >= MIN_PACE_LAPS ? median(values) : null;

const finite = (x: number | null): x is number =>
  typeof x === 'number' && Number.isFinite(x);

function paceOf(d: ResultsDriver): DriverPace | null {
  const valid = d.laps.filter(l => finite(l.t));
  if (valid.length === 0) return null;
  const times = valid.map(l => l.t as number);
  const sector = (pick: (l: ResultsLap) => number | null): SectorPace => {
    const values = valid.map(pick).filter(finite);
    return {best: best(values), median: medianFrom(values)};
  };
  return {
    cls: d.cls,
    car: d.car,
    pos: d.pos,
    you: d.player,
    laps: valid.length,
    best: best(times),
    median: medianFrom(times),
    sectors: [sector(l => l.s1), sector(l => l.s2), sector(l => l.s3)],
  };
}

/**
 * The session doc's `classPace`: every driver with a timed lap, a class at a
 * time (in the order the file lists them) and fastest first inside it. Null
 * without drivers (no results file, or a v1 input).
 */
export function classPaceDoc(
  drivers: readonly ResultsDriver[] | null | undefined,
): ClassPaceDoc | null {
  if (!drivers) return null;
  const paces = drivers.flatMap(d => {
    const p = paceOf(d);
    return p ? [p] : [];
  });
  if (paces.length === 0) return null;
  const order = [...new Set(paces.map(p => p.cls))];
  paces.sort(
    (a, b) =>
      order.indexOf(a.cls) - order.indexOf(b.cls) ||
      (a.best as number) - (b.best as number),
  );
  return {v: CLASS_PACE_VERSION, drivers: paces};
}

/** Whether a stored `classPace` was made by these rules. */
export const classPaceCurrent = (doc: {v?: number} | null | undefined) =>
  doc?.v === CLASS_PACE_VERSION;

export type TopVsYou = {
  cls: string;
  /** How many cars the comparison is over: up to TOP_CARS, fewer in a small class. */
  cars: number;
  /** Their median sector minus his, S1 to S3, seconds; null where either side has none. */
  sectorsS: [number | null, number | null, number | null];
};

/**
 * "Class top 5 vs you": his class's fastest TOP_CARS cars by best valid lap, him
 * excluded; for each sector the median of their sector medians minus his. Null
 * when he is not in the doc or nobody else of his class is.
 */
export function topVsYou(doc: ClassPaceDoc | null): TopVsYou | null {
  const you = doc?.drivers.find(d => d.you);
  if (!doc || !you) return null;
  const others = doc.drivers
    .filter(d => !d.you && d.cls === you.cls)
    .slice(0, TOP_CARS);
  if (others.length === 0) return null;
  const sector = (i: 0 | 1 | 2): number | null => {
    const mine = you.sectors[i].median;
    const theirs = median(others.map(d => d.sectors[i].median));
    return mine == null || theirs == null ? null : theirs - mine;
  };
  return {
    cls: you.cls,
    cars: others.length,
    sectorsS: [sector(0), sector(1), sector(2)],
  };
}

export type MedianVsClass = {
  cls: string;
  /** His median lap and the class's: the median of the other drivers' own medians. */
  youS: number;
  classS: number;
  /** How many other drivers' medians the class's is over. */
  cars: number;
};

/**
 * His median lap against his class's, for the race head. Null when he has no
 * median (under MIN_PACE_LAPS valid laps) or no other driver of his class does.
 */
export function medianVsClass(doc: ClassPaceDoc | null): MedianVsClass | null {
  const you = doc?.drivers.find(d => d.you);
  if (!doc || !you || you.median == null) return null;
  const others = doc.drivers.filter(
    d => !d.you && d.cls === you.cls && d.median != null,
  );
  const classS = median(others.map(d => d.median));
  if (classS == null) return null;
  return {cls: you.cls, youS: you.median, classS, cars: others.length};
}
