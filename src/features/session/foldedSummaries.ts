// The one line each folded section shows on the phone Laps screen (apex, thread
// 44 #1873): what is inside, in numbers, never a verdict.
import type {FuelUse} from './fuelUse';
import type {TiresCard} from './tireCard';

/** "Stint 2 · L14–L26 · 12 green laps", the last stint; the card opens on it. Short enough for one line at 375 pt. */
export function tiresSummary(card: TiresCard): string | null {
  if (card.kind === 'absent') return 'No tire channels';
  const last = card.stints[card.stints.length - 1];
  return last ? `${last.title} · ${last.sub}` : null;
}

/**
 * "2.96 L a lap · median of 9 green laps": the median fuel use over the laps in
 * the card's medians (green, comparable), every stint together, and how many.
 */
export function fuelSummary(fuel: FuelUse): string | null {
  const used = fuel.points.map(p => p.fuelL).sort((a, b) => a - b);
  if (used.length === 0) return 'No stint with enough laps';
  const mid = used.length >> 1;
  const median = used.length % 2 ? used[mid] : (used[mid - 1] + used[mid]) / 2;
  return `${median.toFixed(2)} L a lap · median of ${used.length} green ${
    used.length === 1 ? 'lap' : 'laps'
  }`;
}
