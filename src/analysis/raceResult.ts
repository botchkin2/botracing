// The player's finishing position in a race, from the encoded field (docs/API.md,
// GET /sessions/{id}/field/{hash}): the game's scoring place at the last update
// the player is in the field, and the place among the cars of its class
// (pit-wall thread 44 #1910). The uploader (tools/sessions/sync.mjs) computes
// it once per session and stores it as the session doc's `result`, so the
// Sessions list never downloads a field. Plain TypeScript with erasable syntax
// only, no imports: Node runs it.
//
// "At the flag" is as close as the field gets: it has no chequered-flag
// column, so the position is the last one the recording saw. A race left early
// reads as the place at the moment the driver left; `lapsDone` and
// `leaderLapsDone` are stored so the number can be read against the laps.

/** The encoded field file, only the columns this reads. */
export interface ResultField {
  cars: {class: string; player?: boolean}[];
  /** Per car, the game's overall place from 1; null = the car was absent. */
  place: (number | null)[][];
  /** Per car, laps completed; null = absent. */
  laps: (number | null)[][];
}

/** Bump when the rule below changes: every session recomputes it once on the next sync. */
export const FINISH_VERSION = 1;

export interface FinishPosition {
  /** The game's place among all cars, from 1. */
  overall: number;
  /** Place among the cars of the player's class, from 1. */
  inClass: number;
  /** Cars in the field at that update. */
  ofOverall: number;
  /** Cars of the player's class at that update. */
  ofClass: number;
  /** The player's laps completed, and the most any car had, then. */
  lapsDone: number;
  leaderLapsDone: number;
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
}

const kindOf = (sessionType: string): FinishDoc['kind'] =>
  sessionType.toLowerCase().startsWith('r') ? 'race' : 'other';

/** The last update the player has a place at, or -1. */
function lastUpdateOf(player: (number | null)[]): number {
  for (let u = player.length - 1; u >= 0; u--) if (player[u] != null) return u;
  return -1;
}

/** The player's place at the last update they are in the field; null with no player or no place. */
export function finishPosition(field: ResultField): FinishPosition | null {
  const me = field.cars.findIndex(c => c.player === true);
  if (me < 0 || !field.place[me]) return null;
  const u = lastUpdateOf(field.place[me]);
  if (u < 0) return null;
  const mine = field.place[me][u] as number;
  const myClass = field.cars[me].class;
  let ofOverall = 0;
  let ofClass = 0;
  let inClass = 1;
  let leaderLapsDone = 0;
  field.cars.forEach((car, i) => {
    const place = field.place[i]?.[u];
    if (place == null) return;
    ofOverall++;
    const laps = field.laps[i]?.[u];
    if (laps != null && laps > leaderLapsDone) leaderLapsDone = laps;
    if (car.class !== myClass) return;
    ofClass++;
    if (i !== me && place < mine) inClass++;
  });
  return {
    overall: mine,
    inClass,
    ofOverall,
    ofClass,
    lapsDone: field.laps[me]?.[u] ?? 0,
    leaderLapsDone,
  };
}

/** What a sync writes for a session that has a field. */
export function finishDoc(field: ResultField, sessionType: string): FinishDoc {
  const kind = kindOf(sessionType);
  return {
    version: FINISH_VERSION,
    kind,
    finish: kind === 'race' ? finishPosition(field) : null,
  };
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
