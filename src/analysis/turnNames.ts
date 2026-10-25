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

type NamedCorner = {n: number; official?: string};

/**
 * A section's one name, on every screen and the map: its turns, "T7", "T2–5",
 * "T10a–T12" (decision lap/2026-10-04-sections-and-compare.md: the app shows
 * turn-based sections; "S1–S3" are the game's sectors only).
 */
export function sectionNameOf(
  section: NamedCorner & {parts: readonly NamedCorner[]},
): string {
  const cs = section.parts.length ? section.parts : [section];
  return sectionHeaderOf(cs.map(c => c.official ?? `T${c.n}`));
}

/**
 * A section's name at its shortest, for a label with room for three characters:
 * its first corner alone ("T2–4" is "2", "T10A–T12" is "10A", "S/F" is "SF"), the
 * way the map numbers a turn. Every screen's narrow label reads this.
 */
export function shortSectionName(name: string): string {
  return name
    .split(/[–-]/)[0]
    .replace(/^T(?=\d)/, '')
    .replace('/', '');
}

/** A map badge: the turn's number on the bare part only; a phase part has none, so a turn never shows two. */
export function turnBadgeOf(label: string): string {
  return PHASE.test(label) ? '' : label.replace(/^T/, '');
}

/** A Corner title: "Turn 7" or "Turn 7 entry". */
export function turnTitleOf(label: string): string {
  return `Turn ${label.replace(/^T/, '')}`;
}
