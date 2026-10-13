// The one line each folded section shows on the phone Laps screen (apex, thread
// 44 #1873): what is inside, in numbers, never a verdict.
import {type FuelUse} from './fuelUse';
import type {PitCard} from './pitCard';
import type {TiresCard} from './tireCard';
import {median} from '@/src/analysis/setStats';

/**
 * "2 stops · 95.6 s and 45.4 s in the lane": how many stops and the time each
 * took in the lane (the ones that are measured). A race with no stop has the
 * fuel card instead, which needs no line.
 */
export function pitSummary(card: PitCard): string | null {
  if (card.kind !== 'stops') return null;
  const lanes = card.columns
    .map(c => c.lane?.value)
    .filter((v): v is string => v != null);
  const n = card.columns.length;
  const stops = `${n} ${n === 1 ? 'stop' : 'stops'}`;
  return lanes.length > 0
    ? `${stops} · ${lanes.join(' and ')} in the lane`
    : stops;
}

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
  const used = fuel.points.map(p => p.fuelL);
  const m = median(used);
  if (m == null) return 'No stint with enough laps';
  return `${m.toFixed(2)} L a lap · median of ${used.length} green ${
    used.length === 1 ? 'lap' : 'laps'
  }`;
}
