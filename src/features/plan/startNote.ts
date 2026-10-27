// What the plan assumes the car starts the race with, said on screen with its
// basis (pit-wall thread 104 #7941/#7945): "Start 87 %" when he typed it,
// "Start 100 % (not set)" when the plan is on a full load. No start is read
// from a session's setup: a qualifying's 16-28 % is worse than a full load
// (telemetry #7946), so the default is never silent and never guessed.
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
  if (hasVe && typed.vePct != null) parts.push(`${shown(typed.vePct)} %`);
  if (typed.fuelL != null) parts.push(`${shown(typed.fuelL)} L`);
  if (parts.length > 0) return `Start ${parts.join(' · ')}`;
  if (hasVe) return `Start ${shown(full.vePct)} % (not set)`;
  return full.fuelL == null
    ? 'Start full load (not set)'
    : `Start ${shown(full.fuelL)} L (not set)`;
}
