import {type PaceClass, type StartGap} from '@/src/analysis/classLaps';
import {type SessionClassLaps} from '@/src/data/sessions';
import {formatLapTime} from '@/src/design';

import {lapName} from './planCards';

// Class timing on the Plan (round 6, section 2; pit-wall thread 44): when the
// faster classes' cars, at their median lap, reach you over a race, from the
// other cars' lap times the uploader keeps on each session (classLaps). Pure.
// The input type is this model's own: one function in `useClassTiming` adapts
// the session docs to it, so a change to the stored shape costs one place.

/** Fewer sessions than this is not a class pace. (The uploader's own floor is 3 laps in a session; this is 3 sessions.) */
export const MIN_CLASS_SESSIONS = 3;
/** Races alone make the pool from this many; fewer, and practice joins them. */
export const MIN_RACE_SESSIONS = 3;
/** Enough passes to fill any race the Plan draws. */
const MAX_PASSES = 20;

/** One session at the track with other cars' laps, as this model reads it. */
export type ClassSession = {
  kind: 'race' | 'practice';
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
 * The one place a stored `classLaps` (the session list serves it, and so does
 * the full doc) becomes the model's input: qualifying has no class laps and is
 * left out; so is a session without a field or without a class pace.
 */
export function classSessionOf(s: {
  classLaps: SessionClassLaps | null;
}): ClassSession | null {
  const doc = s.classLaps;
  if (!doc || doc.kind === 'qualify' || !doc.classes) return null;
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
  return {kind: doc.kind, byClass};
}

export type ClassTimingInput = {
  /** Every race and practice at the track with a field, whatever car he drove. */
  sessions: ClassSession[];
  /** His own class. */
  mine: {
    /** Null when his sessions carry no class. */
    key: PaceClass | null;
    /** As LMU writes it ("LMGT3"); shown on the card. */
    name: string;
    /** The plan's median green lap; null without green laps. */
    medianLapS: number | null;
    greenLaps: number;
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

export type FasterClass = {
  key: PaceClass;
  label: string;
  /** Null when fewer than MIN_CLASS_SESSIONS sessions saw the class. */
  estimate: {
    lapText: string;
    gainText: string;
    firstText: string;
    /** Where the grid gap came from, or "Assumes a level start." when no race recorded it. */
    firstNote: string;
    everyText: string;
    passes: Pass[];
  } | null;
  /** "From 2 races, 1 practice · n = 280 laps", or the empty state's sentence. */
  text: string;
};

export type YourClass = {
  name: string;
  classText: string;
  classSrc: string;
  youText: string;
  youSrc: string;
};

export type ReadyClassTiming = Extract<ClassTiming, {kind: 'ready'}>;

export type ClassTiming =
  /** No session here has other cars' laps. */
  | {kind: 'no-field'}
  /** Nothing of his own to set the gain against. */
  | {kind: 'no-laps'}
  | {
      kind: 'ready';
      faster: FasterClass[];
      /** No class was faster than his: the table is replaced by a sentence. */
      noFaster: boolean;
      yours: YourClass | null;
      /** Laps the timeline spans, and where his stops fall on it. */
      raceLaps: number | null;
      stopsAfter: number[];
    };

export const NO_FIELD_TEXT = 'No other cars recorded at this track yet.';
export const NO_LAPS_TEXT =
  'Class timing needs green laps of yours here to set the gain against.';
export const NO_FASTER_TEXT = 'No faster class was recorded at this track.';

const LABELS: Record<PaceClass, string> = {
  hypercar: 'Hypercar',
  lmp2: 'LMP2',
  gt3: 'GT3',
  gte: 'GTE',
  other: 'Other',
};
// The fastest first, as the classes line up on a track.
const ORDER: PaceClass[] = ['hypercar', 'lmp2', 'gte', 'gt3'];

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = (v.length - 1) / 2;
  return (v[Math.floor(mid)] + v[Math.ceil(mid)]) / 2;
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const thousands = (n: number) => n.toLocaleString('en-GB');

type Pooled = {
  medianS: number;
  p10S: number;
  p90S: number;
  /** Median over the used races that recorded the start, leader and tail; null when none did. */
  gap: StartGap | null;
  /** True when practice laps are in the pool because races alone were too few. */
  fromPractice: boolean;
  sessions: number;
  races: number;
  practices: number;
  laps: number;
};

/**
 * The median of the per-session medians: one long race does not outweigh the
 * rest. Races alone when there are MIN_RACE_SESSIONS of them (practice laps
 * are push laps and run faster than a race pace); otherwise every session,
 * marked as from practice.
 */
function pool(sessions: ClassSession[], key: PaceClass): Pooled | null {
  const seen = sessions.flatMap(s => {
    const c = s.byClass[key];
    return c ? [{kind: s.kind, ...c}] : [];
  });
  if (seen.length === 0) return null;
  const races = seen.filter(s => s.kind === 'race');
  const raceOnly = races.length >= MIN_RACE_SESSIONS;
  const used = raceOnly ? races : seen;
  const gaps = used.flatMap(s => (s.gap == null ? [] : [s.gap]));
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
    fromPractice: !raceOnly && used.some(s => s.kind === 'practice'),
    sessions: seen.length,
    races: used.filter(s => s.kind === 'race').length,
    practices: used.filter(s => s.kind === 'practice').length,
    laps: used.reduce((a, s) => a + s.laps, 0),
  };
}

function fromText(p: Pooled): string {
  const parts = [
    p.races > 0 && plural(p.races, 'race'),
    p.practices > 0 && plural(p.practices, 'practice'),
  ].filter(Boolean);
  return `From ${parts.join(', ')} · n = ${thousands(p.laps)} laps${
    p.fromPractice
      ? ` · under ${MIN_RACE_SESSIONS} races, so practice counts`
      : ''
  }`;
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

/** "Grid gap 26-28 s": the class's tail to its leader. */
const gapNote = (g: StartGap): string => {
  const [tail, lead] = [Math.round(g.lastS), Math.round(g.firstS)];
  return `Grid gap ${
    tail === lead ? tail : `${tail}–${lead}`
  } s, from the races' starts.`;
};

const rangeText = (lo: number, hi: number) =>
  Number.isFinite(hi)
    ? `${lapName(Math.ceil(lo))}–${lapName(Math.floor(hi))}`
    : `${lapName(Math.ceil(lo))} or later`;

/** The words in a class lane that has no pass inside the race. */
export const noPassText = (raceLaps: number, firstText: string) =>
  `No pass in ${raceLaps} laps (first at ${firstText})`;

export function classTiming(input: ClassTimingInput): ClassTiming {
  const {sessions, mine, raceLaps, stopsAfter} = input;
  if (sessions.length === 0) return {kind: 'no-field'};
  if (mine.medianLapS == null) return {kind: 'no-laps'};
  const myLap = mine.medianLapS;

  const faster: FasterClass[] = [];
  for (const key of ORDER) {
    if (key === mine.key) continue;
    const p = pool(sessions, key);
    if (!p || p.medianS >= myLap) continue;
    if (p.sessions < MIN_CLASS_SESSIONS) {
      faster.push({
        key,
        label: LABELS[key],
        estimate: null,
        text: `No estimate. ${plural(p.sessions, 'session')} here had ${
          LABELS[key]
        } cars; an estimate needs ${MIN_CLASS_SESSIONS}.`,
      });
      continue;
    }
    const gain = myLap - p.medianS;
    const every = catchLaps(p.medianS, myLap);
    const gap = p.gap ?? LEVEL_START;
    const band = {
      lo: firstCatch(p.p10S, myLap, gap.firstS),
      hi: firstCatch(p.p90S, myLap, gap.lastS),
    };
    faster.push({
      key,
      label: LABELS[key],
      estimate: {
        lapText: formatLapTime(p.medianS),
        gainText: `${gain.toFixed(1)} s`,
        firstText: rangeText(band.lo, band.hi),
        firstNote: p.gap == null ? 'Assumes a level start.' : gapNote(p.gap),
        everyText: `~${Math.round(every)} laps`,
        passes: raceLaps == null ? [] : passesOf(p, myLap, raceLaps, gap),
      },
      text: fromText(p),
    });
  }

  const mineClass = mine.key ? pool(sessions, mine.key) : null;
  const yours: YourClass | null = mineClass
    ? {
        name: mine.name,
        classText: formatLapTime(mineClass.medianS),
        classSrc: `${plural(mineClass.sessions, 'session')} · n = ${thousands(
          mineClass.laps,
        )} laps`,
        youText: formatLapTime(myLap),
        youSrc: `n = ${plural(mine.greenLaps, 'green lap')} · ${plural(
          mine.sessions,
          'session',
        )}`,
      }
    : null;

  return {
    kind: 'ready',
    faster,
    noFaster: faster.length === 0,
    yours,
    raceLaps,
    stopsAfter,
  };
}
