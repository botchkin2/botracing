import {type ChannelId} from '@/src/state/comparePrefs';

// The lines behind a chart's "?": what each trace is, how it is measured, what
// direction means. The subject is the data, never the driver (camber, pit-wall
// thread 33 #937). Steering has no left/right line until we know the sign from
// the sim.
const CHANNEL_HELP: Record<ChannelId, string> = {
  timeDiff:
    'Time diff: the running gap to the reference lap. Above zero this lap is behind the reference at that point; where the line rises, time is being lost over that stretch, and where it falls, gained.',
  speed:
    'Speed: ground speed at each point of the lap, in km/h. The bottom of a dip is the lowest speed there.',
  throttle:
    'Throttle: pedal position, 0–100 %. Where the line starts to rise is where the pedal was picked up.',
  brake:
    'Brake: pedal position, 0–100 %, drawn as a filled area. The fill starts where the pedal was first pressed; its height is how hard, its width how long, and the slope down how quickly it was released.',
  steering:
    'Steering: the band at the bottom, in % of full lock (100 % is the wheel turned as far as it goes), with 0 straight ahead. A second bump inside one corner is a correction.',
  gear: 'Gear: the gear selected. Each step is a shift.',
};

/** The lines for a chart showing these channels, in chart order. */
export function chartHelp(channels: readonly ChannelId[]): string[] {
  return channels.map(c => CHANNEL_HELP[c]);
}

/** The radar docked beside a chart (round 3 R2b). */
export const RADAR_HELP: readonly string[] = [
  "This lap's car is at the centre, pointing up; the view turns with it.",
  'The rings are 10 m and 20 m from your car.',
  'A bar on the edge means a car is alongside.',
  'The clock is the race time of the sample shown.',
];
