// What a section column opens, in a session and in a day alike: the head opens
// Compare on that section, a cell opens Corner on it. One place, so no view
// (the day's included) can lose them on its own. Pure.

import {compareHref, cornerHref} from '@/src/nav/routes';

import {gridCellTargetOf, type SectionTable} from './model';

/** Which section columns open something: the game's sectors and the start straight do not. */
export function sectionTapsOf(
  table: SectionTable | null | undefined,
): boolean[] {
  return table?.targets.map(t => t.corner != null) ?? [];
}

/** Where a column head opens (Compare on that section), null where it opens nothing. */
export function sectionHeadHref(
  sessionId: string,
  table: SectionTable | null | undefined,
  column: number,
  laps: string[],
  set: 'day' | null,
): ReturnType<typeof compareHref> | null {
  const corner = table?.sections[column];
  return corner == null ? null : compareHref(sessionId, {laps, corner, set});
}

/** Where a cell opens (Corner on that section, the tapped lap highlighted), null where it opens nothing. */
export function sectionCellHref(
  sessionId: string,
  table: SectionTable | null | undefined,
  column: number,
  lapId: string,
  laps: string[],
  set: 'day' | null,
): ReturnType<typeof cornerHref> | null {
  const target = table && gridCellTargetOf(table, column, lapId, laps);
  return target
    ? cornerHref(
        sessionId,
        target.corner,
        {laps: target.laps, hl: lapId, set},
        target.whole,
      )
    : null;
}
