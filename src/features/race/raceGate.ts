// Which state the Race screen is in before it can draw, from what has loaded.
// Pure, so every way the screen can end up waiting is tested: a state that can
// never resolve must not read as "loading" (pitboard #4507: a one-lap parked
// race waited for a racing line forever; radio #4511: so did a failed trace).

export type RaceGate =
  | 'loading'
  | 'error'
  | 'no-field'
  | 'field-error'
  | 'no-lap'
  | 'no-line'
  | 'line-error'
  | 'field-loading'
  | 'ready';

/**
 * The racing line, drawn from the best lap's trace: still on its way, drawn,
 * failed (a request; a retry can help), or missing (no lap length to grid it
 * on, or a trace with no GPS; nothing can help).
 */
export type LineState = 'pending' | 'drawn' | 'failed' | 'missing';

/**
 * The field hash the Race screen loads, and the line its empty state shows.
 * A garbage mark is stored and not drawn: the gate sees no field, and `why`
 * is that field's note (useRaceData).
 */
export function raceScreenField(
  detail:
    | {
        field?: {
          hash?: string | null;
          mark?: {kind?: string} | null;
          note?: string | null;
        } | null;
        fieldMissing?: string | null;
      }
    | null
    | undefined,
): {hash: string | null; why: string | null | undefined} {
  const field = detail?.field;
  const hide = field?.mark?.kind === 'garbage';
  return {
    hash: hide ? null : (field?.hash ?? null),
    why: field?.note ?? detail?.fieldMissing,
  };
}

export function raceGate(input: {
  sessionPending: boolean;
  hasDetail: boolean;
  /** The session doc names a field (`field.hash`). */
  hasField: boolean;
  fieldError: boolean;
  /** The session has a best lap, the racing line's source. */
  hasBestLap: boolean;
  line: LineState;
  /** Everything else the ready screen needs (prepared field, clock, laps). */
  readyInputs: boolean;
}): RaceGate {
  if (input.sessionPending) return 'loading';
  if (!input.hasDetail) return 'error';
  if (!input.hasField) return 'no-field';
  if (input.fieldError) return 'field-error';
  // No line means no track to put any car on, whether or not they have positions.
  if (!input.hasBestLap) return 'no-lap';
  if (input.line === 'missing') return 'no-line';
  if (input.line === 'failed') return 'line-error';
  return input.line === 'drawn' && input.readyInputs
    ? 'ready'
    : 'field-loading';
}
