// The lines behind the "?" of the Race timeline (CODE_STANDARDS section 7):
// what a mark is and how it is measured. The data is the subject; no advice.
// Tested with the other how-to-read copy (features/corner/stripsHelp.test.ts).

export const TIMELINE_HELP: readonly string[] = [
  'Stints: each box is one tank, from one stop to the next. Class lanes: a grey band is the laps a faster class reaches the car, from its p10 to its p90 lap; the white tick is its median lap.',
  'The bands widen with each pass. The first pass counts the grid gap to the class where the recorded races give it, and otherwise assumes a level start. Staggered starts, grid order and traffic are not modelled.',
  'Amber box: the pit window. Amber line: the planned stop. Grey tick: where the tank runs out at the median use. Stops are planned at p90 use per lap, so the window is the safe one; each window assumes the earlier stops at plan. Amber dashes through the class lanes are the planned stops.',
];
