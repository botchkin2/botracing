// What the chase engine takes and gives. The engine is web-only (three.js) and loaded lazily by ChaseView.web.tsx.

import type {ChaseRoad} from '../../../analysis/chaseRoad';
import type {ChaseCar, ChaseRibbon} from '../components/chaseTypes';

/** The app's design tokens the scene uses, resolved to colour strings by the caller. */
export interface ChaseTheme {
  bg: string;
  fill: string;
  edge: string;
  edgeFaint: string;
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
