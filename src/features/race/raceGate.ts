// Which state the Race screen is in before it can draw, from what has loaded.
// Pure, so every way the screen can end up waiting is tested: a state that can
// never resolve must not read as "loading" (pitboard #4507: a one-lap parked
// race waited for a racing line forever).

export type RaceGate =
  | 'loading'
  | 'error'
  | 'no-field'
  | 'no-lap'
  | 'field-error'
  | 'field-loading'
  | 'ready';

export function raceGate(input: {
  sessionPending: boolean;
  hasDetail: boolean;
  /** The session doc names a field (`field.hash`). */
  hasField: boolean;
  fieldError: boolean;
  /** The stored field has car positions (LMU); null until it loads. */
  hasPositions: boolean | null;
  /** The session has a best lap, the racing line's source. */
  hasBestLap: boolean;
  /** Everything the ready screen needs (line, prepared field, clock, laps). */
  readyInputs: boolean;
}): RaceGate {
  if (input.sessionPending) return 'loading';
  if (!input.hasDetail) return 'error';
  if (!input.hasField) return 'no-field';
  if (input.fieldError) return 'field-error';
  // The racing line is drawn from the best lap: without one there is no track
  // to put any car on, whether or not they have positions.
  if (!input.hasBestLap) return 'no-lap';
  return input.readyInputs ? 'ready' : 'field-loading';
}
