/** One car as the 3D chase draws it: the Race screen's own numbers, nothing recomputed. */
export type ChaseCar = {
  index: number;
  /** The sim's world metres: x east, z north. */
  xM: number;
  zM: number;
  /** Radians, 0 along +z; null in files before v2. */
  headingRad: number | null;
  speedKmh: number;
  carClass: string;
  /** Class colour from the design tokens, for the windscreen band. */
  color: string;
  player: boolean;
  lapDistM: number;
  /** Class position, or '' in the garage. Numbers only. */
  label: string;
  state: string;
};

/** The followed car's place and its gaps in its class, from the Race screen's own standings. */
export type ChaseGaps = {
  classTag: string;
  classPlace: number;
  /** Seconds to the car ahead in class / seconds the car behind in class is behind; null for a leader / a last car. */
  aheadS: number | null;
  behindS: number | null;
};

/** The player's lap as driven, in the sim's world metres, with throttle and brake per point (5 m apart). */
export type ChaseRibbon = {
  x: number[];
  y: number[];
  th: number[];
  br: number[];
  stepM: number;
};

/** The player's recorded inputs at the race clock (from the lap's trace); null when not loaded or not the player's lap. */
export type ChaseNow = {
  /** Index into the ribbon: where the player is on this lap. */
  idx: number;
  throttlePct: number;
  brakePct: number;
  steeringPct: number;
  gear: number;
  speedKph: number;
};

export type ChaseInputs = {ribbon: ChaseRibbon; now: ChaseNow | null};
