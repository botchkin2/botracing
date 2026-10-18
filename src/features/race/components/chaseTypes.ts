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
