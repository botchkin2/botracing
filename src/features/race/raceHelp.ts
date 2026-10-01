// The lines behind the "?" on the Race screen (thread 33 #1119).
// The same screen outside a race: no places, no gap to a leader.
export const FIELD_HELP: readonly string[] = [
  'Positions are recorded 5 times a second. The dots move smoothly between recorded samples; the numbers are the recorded ones.',
  'Road is the distance along the track from the recorded car to each other car at the playback position: plus is ahead, minus is behind. A car a lap down reads as near.',
  'There is no race position here. Cars in the pit lane or the garage are not counted as ahead or behind.',
];

export const RACE_HELP: readonly string[] = [
  'Positions are recorded 5 times a second. The dots move smoothly between recorded samples; the numbers are the recorded ones.',
  'The number on a dot is the car’s position in its class.',
  'Gap is the time behind the class leader when the car was at the same point of the track. +1 lap means a whole lap of distance behind.',
];
