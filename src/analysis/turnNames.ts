// One naming rule for a turn's parts. "T7 entry" and "T7" are one turn (T7) in
// two phases: the part with a phase word (entry, exit) and the bare turn. Every
// header, map badge and title reads this module, so they cannot disagree.
import {turnRangeLabel} from './segments';

const PHASE = /\s+(entry|exit)$/i;

/** The turn a part belongs to: "T7 entry" is "T7". */
export function turnOfPart(label: string): string {
  return label.replace(PHASE, '');
}

/** The header for a section's parts: one name per turn, a range across turns. */
export function sectionHeaderOf(labels: readonly string[]): string {
  const turns = labels.map(turnOfPart);
  return turnRangeLabel(turns.filter((t, i) => i === 0 || t !== turns[i - 1]));
}

/** A map badge: the turn's number on the bare part only; a phase part has none, so a turn never shows two. */
export function turnBadgeOf(label: string): string {
  return PHASE.test(label) ? '' : label.replace(/^T/, '');
}

/** A Corner title: "Turn 7" or "Turn 7 entry". */
export function turnTitleOf(label: string): string {
  return `Turn ${label.replace(/^T/, '')}`;
}
