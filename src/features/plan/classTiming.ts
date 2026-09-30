import {type ClassKey} from '@/src/analysis/carClass';
import {formatLapTime} from '@/src/design';

import {lapName} from './planCards';

// Class timing on the Plan (round 6, section 2; pit-wall thread 44): when the
// faster classes' cars, at their median lap, reach you over a race, from the
// other cars' lap times the uploader keeps on each session (classLaps). Pure.
// The input type is this model's own: one function in `useClassTiming` adapts
// the session docs to it, so a change to the stored shape costs one place.

/** Fewer sessions than this is not a class pace (matches the uploader's rule). */
export const MIN_CLASS_SESSIONS = 3;
/** The first catch is this many laps either side; each pass adds HALF_BAND_STEP. */
export const FIRST_HALF_BAND_LAPS = 1.5;
export const HALF_BAND_STEP_LAPS = 0.5;
/** Enough passes to fill any race the Plan draws. */
const MAX_PASSES = 20;

/** One session at the track with other cars' laps, as this model reads it. */
export type ClassSession = {
  kind: 'race' | 'practice';
  /** Per class: the median green lap of its cars in that session, and how many laps it rests on. */
  byClass: Partial<Record<ClassKey, {medianS: number; laps: number}>>;
};

export type ClassTimingInput = {
  /** Every race and practice at the track with a field, whatever car he drove. */
  sessions: ClassSession[];
  /** His own class. */
  mine: {
    /** Null when his sessions carry no class. */
    key: ClassKey | null;
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
  lo: number;
  hi: number;
};

export type FasterClass = {
  key: ClassKey;
  label: string;
  /** Null when fewer than MIN_CLASS_SESSIONS sessions saw the class. */
  estimate: {
    lapText: string;
    gainText: string;
    firstText: string;
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

const LABELS: Record<ClassKey, string> = {
  hypercar: 'Hypercar',
  lmp2: 'LMP2',
  gt3: 'GT3',
  other: 'Other',
};
// The fastest first, as the classes line up on a track.
const ORDER: ClassKey[] = ['hypercar', 'lmp2', 'gt3'];

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = (v.length - 1) / 2;
  return (v[Math.floor(mid)] + v[Math.ceil(mid)]) / 2;
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const thousands = (n: number) => n.toLocaleString('en-GB');

type Pooled = {
  medianS: number;
  sessions: number;
  races: number;
  practices: number;
  laps: number;
};

/** The median of the per-session medians: one long race does not outweigh the rest. */
function pool(sessions: ClassSession[], key: ClassKey): Pooled | null {
  const seen = sessions.flatMap(s => {
    const c = s.byClass[key];
    return c ? [{kind: s.kind, ...c}] : [];
  });
  if (seen.length === 0) return null;
  return {
    medianS: median(seen.map(s => s.medianS)),
    sessions: seen.length,
    races: seen.filter(s => s.kind === 'race').length,
    practices: seen.filter(s => s.kind === 'practice').length,
    laps: seen.reduce((a, s) => a + s.laps, 0),
  };
}

function fromText(p: Pooled): string {
  const parts = [
    p.races > 0 && plural(p.races, 'race'),
    p.practices > 0 && plural(p.practices, 'practice'),
  ].filter(Boolean);
  return `From ${parts.join(', ')} · n = ${thousands(p.laps)} laps`;
}

/** Passes of a class at `everyLaps` apart, the bands widening with each one. */
export function passesOf(everyLaps: number, raceLaps: number): Pass[] {
  const out: Pass[] = [];
  for (let k = 1; k <= MAX_PASSES; k++) {
    const centre = k * everyLaps;
    const half = FIRST_HALF_BAND_LAPS + HALF_BAND_STEP_LAPS * (k - 1);
    if (centre - half >= raceLaps) break;
    out.push({centre, lo: Math.max(0, centre - half), hi: centre + half});
  }
  return out;
}

const rangeText = (lo: number, hi: number) =>
  `${lapName(Math.ceil(lo))}–${lapName(Math.floor(hi))}`;

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
    const every = myLap / gain;
    faster.push({
      key,
      label: LABELS[key],
      estimate: {
        lapText: formatLapTime(p.medianS),
        gainText: `${gain.toFixed(1)} s`,
        firstText: rangeText(
          Math.max(0, every - FIRST_HALF_BAND_LAPS),
          every + FIRST_HALF_BAND_LAPS,
        ),
        everyText: `~${Math.round(every)} laps`,
        passes: raceLaps == null ? [] : passesOf(every, raceLaps),
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
