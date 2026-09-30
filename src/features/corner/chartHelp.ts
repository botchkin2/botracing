// The lines behind the "?" on each of Corner's zoom charts: what the lines are,
// how they were measured (each channel's own rate, from the game's channel
// list in docs/LMU_SYNC_NOTES.md: pedals 50 Hz, speed and steering 100 Hz,
// position 10 Hz), what direction means. Round 5, item 7; the speed lines are
// the handoff's own. The subject is the data, never the driver (camber,
// pit-wall thread 33 #937). Steering has no left/right line until the sign is
// measured.
export type CornerChartHelp =
  | 'delta'
  | 'speed'
  | 'brake'
  | 'throttle'
  | 'steering';

const GRID = 'Laps are aligned on a 5 m position grid.';

export const CORNER_CHART_HELP: Record<CornerChartHelp, readonly string[]> = {
  delta: [
    'The time difference to the reference lap, one line per lap.',
    'From each lap’s own recorded clock at every 5 m point, minus the reference lap’s, and zeroed at the corner entry.',
    'Above zero = behind the reference since the entry. A line that rises is losing time over that stretch; one that falls is gaining it.',
  ],
  speed: [
    'Car speed along the corner, one line per lap.',
    `Game telemetry at 100 Hz, drawn at its recorded samples. ${GRID}`,
    'Higher = faster. The lowest point of each line is its minimum speed.',
  ],
  brake: [
    'Brake pedal position along the corner, 0–100 %, one line per lap.',
    `Game telemetry at 50 Hz, drawn at its recorded samples. ${GRID}`,
    'Higher = pressed harder. Where a line leaves zero is where the pedal was first pressed.',
  ],
  throttle: [
    'Throttle pedal position along the corner, 0–100 %, one line per lap.',
    `Game telemetry at 50 Hz, drawn at its recorded samples. ${GRID}`,
    'Higher = pedal further down. Where a line reaches 100 % is full throttle.',
  ],
  steering: [
    'Steering wheel angle along the corner, in % of full lock (100 % is the wheel turned as far as it goes), one line per lap.',
    `Game telemetry at 100 Hz, drawn at its recorded samples. ${GRID}`,
    'Zero is straight ahead. A second bump inside one corner is a second change of steering angle.',
  ],
};
