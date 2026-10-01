// The lines behind the "?" on the Race screen (thread 33 #1119).
// The same screen outside a race: no places, no gap to a leader.
export const FIELD_HELP: readonly string[] = [
  'Positions are recorded 5 times a second. The dots move smoothly between recorded samples; the numbers are the recorded ones.',
  'Road is the time along the track between the recorded car and each other car at the playback position: plus is ahead (its distance over the recorded car’s speed), minus is behind (its distance over that car’s own speed). The summary line gives the metres too. A car a lap down reads as near, and a faster class is listed as coming only within 5 s.',
  'There is no race position here. Cars in the pit lane or the garage are not counted as ahead or behind.',
];

export const RACE_HELP: readonly string[] = [
  'Positions are recorded 5 times a second. The dots move smoothly between recorded samples; the numbers are the recorded ones.',
  'The number on a dot is the car’s position in its class.',
  'Gap is the time behind the class leader when the car was at the same point of the track. +1 lap means a whole lap of distance behind.',
];
