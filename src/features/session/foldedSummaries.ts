// The one line each folded section shows on the phone Laps screen (apex, thread
// 44 #1873): what is inside, in numbers, never a verdict.
import type {FuelUse} from './fuelUse';
import type {TiresCard} from './tireCard';

/** "Stint 2 · L14–L26 · 12 green laps", the last stint; the card opens on it. Short enough for one line at 375 pt. */
export function tiresSummary(card: TiresCard): string | null {
  if (card.kind === 'absent') return 'No tyre channels';
  const last = card.stints[card.stints.length - 1];
  return last ? `${last.title} · ${last.sub}` : null;
}

/** "3.42 L a lap · 3 stints", the median over the stints that have one. */
export function fuelSummary(fuel: FuelUse): string | null {
  const medians = fuel.stints.flatMap(s =>
    s.medianFuelL == null ? [] : [s.medianFuelL],
  );
  if (medians.length === 0) return 'No stint with enough laps';
  const sorted = [...medians].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return `${median.toFixed(2)} L a lap · ${medians.length} ${
    medians.length === 1 ? 'stint' : 'stints'
  }`;
}
