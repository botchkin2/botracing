// The lines behind the "?" on Corner's window card (pit-wall thread 45): what
// the window is, how its time is split, what the speeds and brake lines are.
// The subject is the data, never the driver (CODE_STANDARDS §7).
export const SECTION_WINDOW_HELP: readonly string[] = [
  'The window runs from one fixed boundary to the next, the same stretch of track for every lap. Windows add up to the lap time, and the start/finish line is always a boundary.',
  'Run-in is the boundary to the lap’s first brake or lift; corner is that point to full throttle held; exit is full throttle to the next boundary. The three add up to the window time.',
  'Speeds are taken at the brake or lift onset, at the slowest point, at full throttle and at the window’s end.',
  'A brake application is brake above 10 % until it falls below 2 %, listed under the corner it brakes for. A lap cut at other boundaries reads re-analysis pending and is not compared. The stint line is the window’s best and median over the comparable laps of that stint, with the gap between them; a lap in the pit lane, off track or under a local yellow here is left out of this window only, a tow or traffic never.',
];
