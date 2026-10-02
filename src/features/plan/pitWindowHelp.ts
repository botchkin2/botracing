// The lines behind the "?" of the pit window on the Stops card (CODE_STANDARDS
// section 7): what a window is and how its ends are measured. The data is the
// subject; no advice. Tested with the other how-to-read copy
// (features/corner/stripsHelp.test.ts).

export const PIT_WINDOW_HELP: readonly string[] = [
  'Stops are planned at p90 use per lap (the heavier 10 % of the laps), with no reserve, so the window is the safe one.',
  'Earliest: the laps after it still fit in full tanks. Latest: the lap the tank runs out, the earlier stops as late as they can be. Each stop after the first must also come within a tank of the one before.',
  'In a timed race the window uses the race length plus one lap, because the flag can fall late. At median use is where the tank would run out at the median lap.',
  'A mandatory stop that refuels makes the real window wider.',
];
