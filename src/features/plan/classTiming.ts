import {
  paceClass,
  type PaceClass,
  type StartGap,
} from '@/src/analysis/classLaps';
import {type SessionClassLaps} from '@/src/data/sessions';
import {formatGap, formatLapTime} from '@/src/design';

import {lapName} from './planCards';

// Class pace on the Plan (round 6, section 2; pit-wall thread 44; Botkin's
// D55): every class's pace at the track and, against his own median, when the
// faster ones reach him over a race, from the other cars' lap times the
// uploader keeps on each session (classLaps). It needs no fuel and none of his
// laps: he drives GT3 and will never have Hypercar laps of his own. Pure.
// The input type is this model's own: one function in `useClassTiming` adapts
// the session docs to it, so a change to the stored shape costs one place.

/** Enough passes to fill any race the Plan draws. */
const MAX_PASSES = 20;

/** One session at the track with other cars' laps, as this model reads it. */
export type ClassSession = {
  kind: 'race' | 'practice';
  /** The class he drove in it: grid gaps are measured from his car, so only his own class's races give his gaps. */
  player: PaceClass | null;
  /** Per class: the median green lap of its cars in that session, and how many laps it rests on. */
  byClass: Partial<
    Record<
      PaceClass,
      {
        medianS: number;
        p10S: number;
        p90S: number;
        laps: number;
        /** Seconds this class's first and last car crossed the line before the player at the race start; races from CLASS_LAPS_VERSION 2. */
        gap?: StartGap;
      }
    >
  >;
};

/**
 * iRacing classes are right from CLASS_LAPS_VERSION 6: before, GTP and the
 * IMSA GT3s pooled as `other`. LMU numbers did not change in 6, so older LMU
 * docs stay in (bias, pit-wall thread 1 #4046).
 */
const MIN_VERSION: Partial<Record<string, number>> = {iracing: 6};

/**
 * The one place a stored `classLaps` (the session list serves it, and so does
 * the full doc) becomes the model's input: qualifying has no class laps and is
 * left out; so is a session without a field or without a class pace, and an
 * iRacing doc older than its class fix.
 */
export function classSessionOf(s: {
  sim: string;
  carClass: string;
  classLaps: SessionClassLaps | null;
}): ClassSession | null {
  const doc = s.classLaps;
  if (!doc || doc.kind === 'qualify' || !doc.classes) return null;
  if (doc.version < (MIN_VERSION[s.sim] ?? 0)) return null;
  const byClass: ClassSession['byClass'] = {};
  for (const [key, stats] of Object.entries(doc.classes)) {
    byClass[key as PaceClass] = {
      medianS: stats.medianS,
      p10S: stats.p10S,
      p90S: stats.p90S,
      laps: stats.laps,
      ...(doc.startGapsS?.[key as PaceClass] != null && {
        gap: doc.startGapsS[key as PaceClass],
      }),
    };
  }
  // Docs before version 6 do not name his class; LMU's car class says it.
  const player = doc.player ?? (s.carClass ? paceClass(s.carClass) : null);
  return {kind: doc.kind, player, byClass};
}

export type ClassTimingInput = {
  /** Every race and practice at the track in this sim with a field, whatever car he drove. */
  sessions: ClassSession[];
  /** His own class. */
  mine: {
    /** Null when nothing says his class (a car he has not driven here). */
    key: PaceClass | null;
    /** His median green lap here, as the fuel plan reads it; null without green laps. */
    medianLapS: number | null;
    /** Laps and sessions the median rests on. */
    laps: number;
    sessions: number;
  };
  /** The plan's race length in laps; null when it has none. */
  raceLaps: number | null;
  /** Racing laps the plan's stops come after. */
  stopsAfter: number[];
};

export type Pass = {
  /** The lap, counted in his laps, around which the class reaches him. */
  centre: number;
  /** Where its p10 lap puts the pass, and where its p90 lap does; `hi` is Infinity when the p90 lap is not faster than his. */
  lo: number;
  hi: number;
};

/** One row of the Class pace table. Every text is final; "—" is not measured. */
export type ClassRow = {
  key: PaceClass;
  label: string;
  /** His class. */
  mine: boolean;
  /** "1:38.0": the pooled median lap, to a tenth; approximate (line crossings at 5 Hz), the head says ≈. */
  lapText: string;
  /** The class median lap minus his median, s, the app's sign: "−12.0" faster, "+3.1" slower (the head says s). */
  vsText: string;
  /** Where, in his laps, it first reaches him: "L8–L11". */
  firstText: string;
  /** His laps between one pass and the next: "~7 laps". */
  everyText: string;
  /** "3 races · 280 laps · grid gap 10–20 s" */
  srcText: string;
  /** Faster than his median: it gets a lane on the timeline. */
  reaches: boolean;
  /** Passes inside the race; empty unless it reaches him. */
  passes: Pass[];
};

export type ClassTiming =
  /** No session here, in this sim, has other cars' laps. */
  | {kind: 'no-field'}
  | {
      kind: 'ready';
      /** Fastest first. */
      rows: ClassRow[];
      /** His own median; null without green laps here. */
      you: {lapText: string; srcText: string} | null;
      /** Laps the timeline spans, and where his stops fall on it. */
      raceLaps: number | null;
      stopsAfter: number[];
    };

export type ReadyClassTiming = Extract<ClassTiming, {kind: 'ready'}>;

export const NO_FIELD_TEXT = 'No other cars recorded here';

const LABELS: Record<PaceClass, string> = {
  hypercar: 'Hypercar',
  lmp2: 'LMP2',
  gt3: 'GT3',
  gte: 'GTE',
  other: 'Other',
};
// `other` is not a class: it pools whatever the sims name oddly.
const SHOWN: PaceClass[] = ['hypercar', 'lmp2', 'gte', 'gt3'];
const NONE = '—';

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = (v.length - 1) / 2;
  return (v[Math.floor(mid)] + v[Math.ceil(mid)]) / 2;
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const thousands = (n: number) => n.toLocaleString('en-GB');

/** A field lap to a tenth: the crossings are interpolated at 5 Hz, so the thousandths are not real. */
const approxLap = (s: number) =>
  formatLapTime(Math.round(s * 10) / 10).slice(0, -2);

type Pooled = {
  medianS: number;
  p10S: number;
  p90S: number;
  /** Median over the races that recorded the start, leader and tail; null when none did. */
  gap: StartGap | null;
  kind: 'race' | 'practice';
  sessions: number;
  laps: number;
};

/**
 * The median of the per-session medians: one long race does not outweigh the
 * rest. Races alone whenever the class raced here: lapping is about race pace
 * (fuel, tyres, traffic), and practice laps are push laps. Practice only when
 * no race saw the class (bias, pit-wall thread 1 #4044). The grid gap is
 * measured from his car, so it comes only from races he drove in `mine`: a
 * gap to a Hypercar start says nothing about his GT3 start.
 */
function pool(
  sessions: ClassSession[],
  key: PaceClass,
  mine: PaceClass | null,
): Pooled | null {
  const seen = sessions.flatMap(s => {
    const c = s.byClass[key];
    return c ? [{kind: s.kind, player: s.player, ...c}] : [];
  });
  if (seen.length === 0) return null;
  const races = seen.filter(s => s.kind === 'race');
  const used = races.length > 0 ? races : seen;
  const gaps = used.flatMap(s =>
    s.gap == null || mine == null || s.player !== mine ? [] : [s.gap],
  );
  return {
    medianS: median(used.map(s => s.medianS)),
    p10S: median(used.map(s => s.p10S)),
    p90S: median(used.map(s => s.p90S)),
    gap:
      gaps.length > 0
        ? {
            firstS: median(gaps.map(g => g.firstS)),
            lastS: median(gaps.map(g => g.lastS)),
          }
        : null,
    kind: races.length > 0 ? 'race' : 'practice',
    sessions: used.length,
    laps: used.reduce((a, s) => a + s.laps, 0),
  };
}

/** "3 races · 280 laps", then the grid gap when the races recorded one. */
function srcText(p: Pooled): string {
  const parts = [plural(p.sessions, p.kind), `${thousands(p.laps)} laps`];
  if (p.gap) {
    // Negative: that end of the class started behind him.
    const signed = (v: number) => (v < 0 ? `−${-v}` : String(v));
    const [tail, lead] = [Math.round(p.gap.lastS), Math.round(p.gap.firstS)];
    parts.push(
      `grid gap ${
        tail === lead ? signed(tail) : `${signed(tail)}–${signed(lead)}`
      } s`,
    );
  }
  return parts.join(' · ');
}

const LEVEL_START: StartGap = {firstS: 0, lastS: 0};

/**
 * Where, in his laps, a car of lap time `lapS` first reaches him: it needs a
 * lap on him, less the `gapS` seconds it started up the road, at a gain of
 * (m - p) / m of a second per second: lapS * (m - gapS) / (m * (m - lapS)). With
 * no head start that is lapS / (m - lapS). Infinity when it is not faster.
 */
const firstCatch = (lapS: number, myLapS: number, gapS: number): number =>
  myLapS > lapS
    ? (lapS * Math.max(0, myLapS - gapS)) / (myLapS * (myLapS - lapS))
    : Infinity;

/** Laps between one pass and the next: his laps for a faster car to gain a lap on him, lapS / (m - lapS). */
const catchLaps = (lapS: number, myLapS: number): number =>
  myLapS > lapS ? lapS / (myLapS - lapS) : Infinity;

/**
 * Passes of a class: the first at the catch with the grid gap, then one every
 * catchLaps. The band runs from the class's p10 lap with its leader's head
 * start to its p90 lap with its tail's (the class arrives as a train, and the
 * leader gets there first); the centre is the median lap with the mean gap.
 * The band widens with each pass for a real reason, the spread of the class's
 * laps, and needs no constant. The gap is 0 for a level start.
 */
export function passesOf(
  lap: {medianS: number; p10S: number; p90S: number},
  myLapS: number,
  raceLaps: number,
  gap: StartGap = LEVEL_START,
): Pass[] {
  // k = 1 adds nothing: 0 * Infinity is NaN for a lap that is not faster.
  const at = (lapS: number, gapS: number, k: number) =>
    firstCatch(lapS, myLapS, gapS) +
    (k > 1 ? (k - 1) * catchLaps(lapS, myLapS) : 0);
  const midS = (gap.firstS + gap.lastS) / 2;
  const out: Pass[] = [];
  for (let k = 1; k <= MAX_PASSES; k++) {
    const lo = at(lap.p10S, gap.firstS, k);
    if (lo >= raceLaps) break;
    out.push({
      centre: at(lap.medianS, midS, k),
      lo,
      hi: at(lap.p90S, gap.lastS, k),
    });
  }
  return out;
}

function rangeText(lo: number, hi: number): string {
  const first = Math.ceil(lo);
  if (!Number.isFinite(hi)) return `${lapName(first)} or later`;
  const last = Math.max(first, Math.floor(hi));
  return first === last ? lapName(first) : `${lapName(first)}–${lapName(last)}`;
}

/** The words in a class lane that has no pass inside the race. */
export const noPassText = (raceLaps: number, firstText: string) =>
  `No pass in ${raceLaps} laps (first at ${firstText})`;

export function classTiming(input: ClassTimingInput): ClassTiming {
  const {sessions, mine, raceLaps, stopsAfter} = input;
  const myLap = mine.medianLapS;

  const pooled = SHOWN.flatMap(key => {
    const p = pool(sessions, key, mine.key);
    return p ? [{key, p}] : [];
  }).sort((a, b) => a.p.medianS - b.p.medianS);
  if (pooled.length === 0) return {kind: 'no-field'};

  const rows: ClassRow[] = pooled.map(({key, p}) => {
    const own = key === mine.key;
    const gap = p.gap ?? LEVEL_START;
    const base = {
      key,
      label: LABELS[key],
      mine: own,
      lapText: approxLap(p.medianS),
      srcText: srcText(p),
    };
    // vs you, first and every are against his median; his own class has none.
    if (own || myLap == null)
      return {
        ...base,
        vsText: NONE,
        firstText: NONE,
        everyText: NONE,
        reaches: false,
        passes: [],
      };
    // The class's lap against his, the app's sign: minus is faster.
    const vsS = p.medianS - myLap;
    const reaches = vsS < 0;
    return {
      ...base,
      vsText: formatGap(vsS, 1),
      firstText: reaches
        ? rangeText(
            firstCatch(p.p10S, myLap, gap.firstS),
            firstCatch(p.p90S, myLap, gap.lastS),
          )
        : NONE,
      everyText: reaches
        ? `~${Math.round(catchLaps(p.medianS, myLap))} laps`
        : NONE,
      reaches,
      passes:
        reaches && raceLaps != null ? passesOf(p, myLap, raceLaps, gap) : [],
    };
  });

  return {
    kind: 'ready',
    rows,
    you:
      myLap == null
        ? null
        : {
            lapText: formatLapTime(myLap),
            srcText: `${plural(mine.laps, 'lap')} · ${plural(
              mine.sessions,
              'session',
            )}`,
          },
    raceLaps,
    stopsAfter,
  };
}
