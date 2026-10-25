// The player's finishing position in a race, from the encoded field (docs/API.md,
// GET /sessions/{id}/field/{hash}): the game's scoring place when the player
// last crossed the line, and the place among the cars of its class
// (pit-wall thread 44 #1910, parc #1920). The uploader (tools/sessions/sync.mjs)
// computes it once per session and stores it as the session doc's `result`, so
// the Sessions list never downloads a field. Plain TypeScript with erasable
// syntax only, importing only other analysis files by their `.ts` name: Node runs it.
//
// Not the last update the player is in the field: a driver who goes back to
// the garage or the pits after the flag is scored behind everyone, so the last
// update reads last. The place is read at the player's last line crossing (the
// laps counter's last step up). The field has no chequered-flag column, so
// whether the race was finished is read from the leader: if the leader crossed
// the line after the player's last crossing, the player left early.

import type {ResultsDriver} from './classPace.ts';
import {ABSENT, type Field} from './field.ts';
import {lapLabel} from './lapNumbering.ts';

/** The encoded field file, only the columns this reads. */
export interface ResultField {
  cars: {class: string; player?: boolean}[];
  /** Per car, the game's overall place from 1; null = the car was absent. */
  place: (number | null)[][];
  /** Per car, laps completed; null = absent. */
  laps: (number | null)[][];
}

/**
 * Bump when the rule below changes: every session recomputes it once on the
 * next sync. 4: a live race kept its first lap's result (pit wall thread 98).
 */
export const FINISH_VERSION = 4;

export interface FinishPosition {
  /** The game's place among all cars when the player last crossed the line, from 1. */
  overall: number;
  /** Place among the cars of the player's class then, from 1. */
  inClass: number;
  /** Cars in the field then. */
  ofOverall: number;
  /** Cars of the player's class then. */
  ofClass: number;
  /** The player's laps completed at that crossing. */
  lapsDone: number;
  /** The most laps any car completed by the end of the field: the race's length as far as the recording saw it. */
  leaderLapsDone: number;
  /**
   * The most laps any car of the player's class completed by the end of the
   * field: the race's length for the player's car. In a multiclass race the
   * overall leader is a faster class and runs more laps in the same minutes
   * (2 Oct Road Atlanta: 26 overall, a GT3 ran 23). Null when the player's
   * class has no name (an offline iRacing field): every car would be "the
   * class", and the overall leader would pass for the class leader.
   */
  classLeaderLapsDone: number | null;
  /** The leader crossed the line after the player's last crossing: the player stopped before the race did. */
  leftEarly: boolean;
}

/**
 * What a sync writes for a session that has a field. `kind` is read back so a
 * re-typed session recomputes. `finish` is null outside a race and when the
 * player or their place cannot be read.
 */
export interface FinishDoc {
  version: number;
  kind: 'race' | 'other';
  finish: FinishPosition | null;
  /** Where the place came from: the game's results file (its own classification, the referee) or the recorded field. Absent on a doc written before the file was read. */
  source?: 'results' | 'field';
}

const kindOf = (sessionType: string): FinishDoc['kind'] =>
  sessionType.toLowerCase().startsWith('r') ? 'race' : 'other';

/**
 * The update of the player's last line crossing: the last one where the laps
 * counter is higher than at the player's previous reading. -1 without one.
 */
function lastCrossing(laps: (number | null)[]): number {
  let prev: number | null = null;
  let at = -1;
  laps.forEach((v, u) => {
    if (v == null) return;
    if (prev != null && v > prev) at = u;
    prev = v;
  });
  return at;
}

/**
 * The update of the player's last line crossing in a decoded field, by the
 * same rule `finishPosition` reads the result at (so the Race list at that
 * moment is the head's Result); null without a player, a crossing or a place
 * then.
 */
export function finishUpdateOf(field: Field): number | null {
  const me = field.cars.find(c => c.player);
  if (!me) return null;
  const u = lastCrossing(
    Array.from(me.lapsDone, v => (v === ABSENT ? null : v)),
  );
  return u >= 0 && me.place[u] !== ABSENT ? u : null;
}

/** A car's laps at an update: its last reading at or before it, 0 before any. */
function lapsAt(laps: (number | null)[] | undefined, u: number): number {
  if (!laps) return 0;
  for (let i = Math.min(u, laps.length - 1); i >= 0; i--)
    if (laps[i] != null) return laps[i] as number;
  return 0;
}

/** The player's place when they last crossed the line; null with no player, no crossing or no place then. */
export function finishPosition(field: ResultField): FinishPosition | null {
  const me = field.cars.findIndex(c => c.player === true);
  if (me < 0 || !field.place[me] || !field.laps[me]) return null;
  const u = lastCrossing(field.laps[me]);
  const mine = u < 0 ? null : field.place[me][u];
  if (mine == null) return null;
  const myClass = field.cars[me].class;
  const end = Math.max(0, ...field.laps.map(l => (l ? l.length : 0))) - 1;
  let ofOverall = 0;
  let ofClass = 0;
  let inClass = 1;
  let leaderAtCrossing = 0;
  let leaderAtEnd = 0;
  let classLeaderAtEnd = 0;
  field.cars.forEach((car, i) => {
    leaderAtCrossing = Math.max(leaderAtCrossing, lapsAt(field.laps[i], u));
    leaderAtEnd = Math.max(leaderAtEnd, lapsAt(field.laps[i], end));
    if (car.class === myClass)
      classLeaderAtEnd = Math.max(classLeaderAtEnd, lapsAt(field.laps[i], end));
    const place = field.place[i]?.[u];
    if (place == null) return;
    ofOverall++;
    if (car.class !== myClass) return;
    ofClass++;
    if (i !== me && place < mine) inClass++;
  });
  return {
    overall: mine,
    inClass,
    ofOverall,
    ofClass,
    lapsDone: lapsAt(field.laps[me], u),
    leaderLapsDone: leaderAtEnd,
    classLeaderLapsDone: myClass.trim() ? classLeaderAtEnd : null,
    leftEarly: leaderAtEnd > leaderAtCrossing,
  };
}

/** What a sync writes for a session that has a field. */
export function finishDoc(field: ResultField, sessionType: string): FinishDoc {
  const kind = kindOf(sessionType);
  return {
    version: FINISH_VERSION,
    kind,
    finish: kind === 'race' ? finishPosition(field) : null,
    source: 'field',
  };
}

/** The game's own finish for a race from the results input's drivers (v2): his overall and class place, the classified counts, his laps and the leaders', and whether he left early (a FinishStatus other than "Finished Normally"). Null without his row or his overall place. */
export function finishFromResults(
  drivers: readonly ResultsDriver[] | null | undefined,
): FinishPosition | null {
  const me = drivers?.find(d => d.player);
  if (!drivers || !me || me.overall == null || me.pos == null) return null;
  const lapsOf = (d: ResultsDriver) => d.laps.length;
  const mine = drivers.filter(d => d.cls === me.cls);
  return {
    overall: me.overall,
    inClass: me.pos,
    ofOverall: drivers.length,
    ofClass: mine.length,
    lapsDone: lapsOf(me),
    leaderLapsDone: Math.max(...drivers.map(lapsOf)),
    classLeaderLapsDone: me.cls.trim() ? Math.max(...mine.map(lapsOf)) : null,
    leftEarly: me.status != null && me.status !== 'Finished Normally',
  };
}

/** The game's FinishStatus of a driver it classified. */
const FINISHED = 'Finished Normally';

/**
 * The race's stored `result`: the game's results file's when it classified the
 * race, else the field's as it stood (null with neither). The one rule, in one
 * place (thread 111 #7739, #7765, #7771; store.mjs calls it once):
 *  - the file is a classification only if the game classified someone, a driver
 *    whose FinishStatus is "Finished Normally". Of his 125 race files 52 have none:
 *    snapshots the game wrote when he left (Daytona 2026-09-29: 61 of 62 "None"),
 *    not the referee's verdict, so the field's result stands there; the other 73
 *    have finishers and no grey zone, and take the file's;
 *  - and the file must be able to place him (an input from before `overall` existed,
 *    a v1 input, no row of his: the field's stands).
 * No FINISH_VERSION bump: a session gets the file's finish when its v2 input arrives.
 */
export function finishOf(input: {
  drivers: readonly ResultsDriver[] | null | undefined;
  sessionType: string;
  field: FinishDoc | null;
}): FinishDoc | null {
  const {drivers, sessionType} = input;
  if (
    kindOf(sessionType) === 'race' &&
    drivers?.some(d => d.status === FINISHED)
  ) {
    const finish = finishFromResults(drivers);
    if (finish)
      return {version: FINISH_VERSION, kind: 'race', finish, source: 'results'};
  }
  return input.field;
}

/** Whether a stored `result` can be kept: this version of the rule, for this kind of session. */
export function finishCurrent(
  stored: Record<string, unknown> | null | undefined,
  sessionType: string,
): boolean {
  return (
    stored?.version === FINISH_VERSION && stored.kind === kindOf(sessionType)
  );
}

/**
 * The result on a race row and in a race's head. A race the player left early gives the class place
 * with the class leader's laps as a floor, 'P20 GT3 · L20 of L23+' (the same
 * label as the Plan's last-race line: a floor that counts the formation step);
 * the class is left out when it has no name, and 'of L…+' when the class
 * leader's laps are not known.
 */
export function raceResultText(finish: FinishPosition | null): string | null {
  if (!finish) return null;
  if (!finish.leftEarly)
    return `P${finish.overall} · P${finish.inClass} in class`;
  const place = `P${finish.inClass}`;
  const laps =
    finish.classLeaderLapsDone != null
      ? `${lapLabel(finish.lapsDone)} of ${lapLabel(
          finish.classLeaderLapsDone,
        )}+`
      : lapLabel(finish.lapsDone);
  return `${place} · ${laps} (left early)`;
}
