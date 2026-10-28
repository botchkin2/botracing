// What the plan assumes the car starts the race with, said on screen with its
// basis (pit-wall thread 104 #7941/#7945/#7952): "Your start 87 %" when he typed it,
// "Your start 100 % (not set)" when the plan is on a full load. No start is read
// from a session's setup: a qualifying's 16-28 % is worse than a full load
// (telemetry #7942), so the default is never silent and never guessed.
export type StartInput = {vePct: number | null; fuelL: number | null};

/** A typed number as it reads: whole when whole, else one decimal ("87", "62.5"). */
const shown = (v: number) =>
  Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toFixed(1);

/**
 * The start line. A VE car's start is its VE; the litres typed follow it. A car
 * without VE reads litres. `full` is the full load the plan falls back to.
 */
export function startNote(
  typed: StartInput,
  full: {fuelL: number | null; vePct: number},
  hasVe: boolean,
): string {
  const parts: string[] = [];
  // A VE car's plan runs on its VE: the part says "(not set)" whenever he has
  // not typed one, even when he typed litres (telemetry #7954).
  if (hasVe)
    parts.push(
      typed.vePct != null
        ? `${shown(typed.vePct)} %`
        : `${shown(full.vePct)} % (not set)`,
    );
  if (typed.fuelL != null) parts.push(`${shown(typed.fuelL)} L`);
  else if (!hasVe)
    parts.push(
      full.fuelL == null
        ? 'full load (not set)'
        : `${shown(full.fuelL)} L (not set)`,
    );
  return `Your start ${parts.join(' · ')}`;
}
