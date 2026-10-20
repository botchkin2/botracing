// What the 3D draws, made in steps: the road fitted from the field in the game's own world frame, and the field's cars
// at their own recorded positions. The fit is a second or two of work on a phone, so a page drives it in short slices
// (`sliceOptions`) and shows the 3D when it returns, never freezing.

import type {ChaseRoad} from '@/src/analysis/chaseRoad';
import type {Field} from '@/src/analysis/field';
import {type MeasuredEdges, prepareRaceSteps, type RacePrep} from '@/src/analysis/raceState';
import type {Steps} from '@/src/analysis/steps';
import {worldRoadSteps} from '@/src/analysis/worldRoad';

export type ChaseWorld = {road: ChaseRoad; prep: RacePrep};

export interface ChaseWorldInput {
  field: Field;
  lapM: number;
  edges: MeasuredEdges | null;
  elevation: {stepM: number; heightM: number[]} | null;
  elevationLapM: number;
}

/** Null when the field cannot give a road. */
export function* chaseWorldSteps(input: ChaseWorldInput): Steps<ChaseWorld | null> {
  const road = yield* worldRoadSteps(input);
  if (!road) return null;
  const prep = yield* prepareRaceSteps(input.field, input.edges);
  return {road, prep};
}

/** A slice keeps the thread at most this long: a frame is 16 ms, and a long task is anything over 50 ms. */
export const SLICE_BUDGET_MS = 8;

/** Gives the thread back through a message (a timer waits at least 4 ms once nested, which would stretch the whole fit). */
export function yieldToLoop(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise(resolve => setTimeout(resolve, 0));
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
