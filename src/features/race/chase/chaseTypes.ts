// What the chase view and its engine take and give. The engine is web-only (three.js), loaded lazily by ChaseView.web.tsx.

import type {ChaseRoad} from '@/src/analysis/chaseRoad';

/** The app's design tokens the scene uses, resolved to colour strings by the caller. */
export interface ChaseTheme {
  bg: string;
  fill: string;
  edge: string;
  edgeFaint: string;
  /** The datum grid under the road. */
  grid: string;
  text: string;
  muted: string;
  line: string;
  accent: string;
  good: string;
  bad: string;
}

/** 1 Chase, 2 High, 3 TV, 4 Heli. */
export type ChaseCamMode = 1 | 2 | 3 | 4;

export interface ChaseUpdate {
  cars: ChaseCar[];
  focus: number | null;
  playing: boolean;
  rate: number;
  /** Index into the ribbon where the player is, -1 when not on it. */
  inputIdx: number;
}

export interface ChaseEngine {
  setRoad(road: ChaseRoad): void;
  setInputs(ribbon: ChaseRibbon | null): void;
  update(u: Partial<ChaseUpdate>): void;
  setCam(mode: ChaseCamMode): void;
  dispose(): void;
}

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
