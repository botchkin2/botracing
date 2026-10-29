// The rows of the numbers box on a phone (ticket #46, pit-wall thread 106). The box sits in the bottom right corner of
// the 3D, beside the car's rear: at 375 dp four rows covered the car's rear corner in three of four frames (replay
// #7291). The gaps to the cars ahead and behind are not in it: the strip above the canvas already prints each
// neighbour's gap (Botkin 2026-10-24: "The plus minus on the bottom right is redundant of the one at the top"). Two
// rows: the place, then the gear with the speed. Pure: the text is formatted by the caller.

/** What the gear cell shows while the player's inputs are not known at this moment. */
export const GEAR_UNKNOWN = '–';

/** The widest speed the box prints: three figures ("300"). */
const SPEED_CH = 3;

export interface NumberCell {
  text: string;
  /** The figure itself (strong), or its unit (muted). */
  tone: 'strong' | 'muted';
  /** The cell is at least this many characters wide, figures right-aligned: the speed passing 99 to 100 must not move the box's left edge. */
  minCh?: number;
  /** A rule is drawn after the cell: the gear is its own figure, not the thousands of the speed beside it (ticket 75: "2 126 km/h" read as 2,126 km/h). */
  ruleAfter?: boolean;
}

export interface TightNumbersInput {
  /** "GT3 P6"; null when the standings are not known. */
  place: string | null;
  /** "3", "N", "R", or "–" while the player's inputs are not known at this moment; null for a car that never has a gear (not the player's). The cell is one character wide and in the same type either way, so its coming and going moves nothing. */
  gear: string | null;
  speed: string;
}

/** The rows, top to bottom, each a line of cells. */
export function tightNumberRows(i: TightNumbersInput): NumberCell[][] {
  const rows: NumberCell[][] = [];
  if (i.place != null) rows.push([{text: i.place, tone: 'strong'}]);
  rows.push([
    ...(i.gear != null ? [{text: i.gear, tone: 'strong' as const, minCh: 1, ruleAfter: true}] : []),
    {text: i.speed, tone: 'strong', minCh: SPEED_CH},
    {text: 'km/h', tone: 'muted'},
  ]);
  return rows;
}
