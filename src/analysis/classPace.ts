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
  /** The place in his class (the file's ClassPosition). */
  pos: number | null;
  /** The place among all cars (the file's Position) and the file's FinishStatus: the game's own classification, read by `finishFromResults`. Absent in an input written before they were added. */
  overall?: number | null;
  status?: string | null;
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

/** What a driver's laps are: absent for the race's own laps, 'qualifying' for one best lap a car from the weekend's qualifying (iRacing, tools/sessions/irResults.mjs). */
export type ClassPaceBasis = 'qualifying';

export type ClassPaceDoc = {
  v: number;
  drivers: DriverPace[];
  basis?: ClassPaceBasis;
};

// The game prints four decimals: a median of two laps is a half of one, anything finer is noise in the doc's bytes.
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

const best = (values: number[]): number | null =>
  values.length ? round4(Math.min(...values)) : null;

const medianFrom = (values: number[]): number | null => {
  const m = values.length >= MIN_PACE_LAPS ? median(values) : null;
  return m === null ? null : round4(m);
};

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
 * without drivers (no results file, or a v1 input). `basis` is set only when the
 * laps are not the race's own (an iRacing input of qualifying bests), so every
 * other doc is as it was.
 */
export function classPaceDoc(
  drivers: readonly ResultsDriver[] | null | undefined,
  basis?: ClassPaceBasis,
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
  return {v: CLASS_PACE_VERSION, drivers: paces, ...(basis ? {basis} : {})};
}

/** Whether a stored `classPace` was made by these rules. */
export const classPaceCurrent = (doc: {v?: number} | null | undefined) =>
  doc?.v === CLASS_PACE_VERSION;

/**
 * His median of a sector minus a driver's, seconds: + where he is slower. The one
 * place "which way round" is written: the top line takes the median of these over
 * the top cars, and each row's cells are these (thread 111 #7656, #7670). Null
 * when either has no median there.
 */
export function sectorGapS(
  you: DriverPace,
  other: DriverPace,
  sector: 0 | 1 | 2,
): number | null {
  const mine = you.sectors[sector].median;
  const theirs = other.sectors[sector].median;
  return mine === null || theirs === null ? null : mine - theirs;
}

/** Whether `classPace` lists a driver other than him: the one test for "this session knows its other cars" (a doc with only his own laps does not). */
export function hasOtherDrivers(doc: ClassPaceDoc | null): boolean {
  return doc !== null && doc.drivers.some(d => !d.you);
}

export type TopVsYou = {
  cls: string;
  /** How many cars the comparison is over: up to TOP_CARS, fewer in a small class. */
  cars: number;
  /** His median sector minus theirs, S1 to S3, seconds: + is slower than the top cars, as every "vs" number on the screens (livery, thread 111 #7653); null where either side has none. */
  sectorsS: [number | null, number | null, number | null];
};

/**
 * "You vs top 5": his class's fastest TOP_CARS cars by best valid lap, him
 * excluded; for each sector his median minus the median of their sector medians. Null
 * when he is not in the doc or nobody else of his class is.
 */
export function topVsYou(doc: ClassPaceDoc | null): TopVsYou | null {
  const you = doc?.drivers.find(d => d.you);
  if (!doc || !you) return null;
  const others = doc.drivers
    .filter(d => !d.you && d.cls === you.cls)
    .slice(0, TOP_CARS);
  if (others.length === 0) return null;
  const sector = (i: 0 | 1 | 2): number | null =>
    median(others.map(d => sectorGapS(you, d, i)));
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
  /** His minus the class's, + where he is slower: the one signed number, so no screen subtracts. */
  deltaS: number;
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
  return {
    cls: you.cls,
    youS: you.median,
    classS,
    deltaS: you.median - classS,
    cars: others.length,
  };
}
