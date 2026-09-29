import {type NativeSamples} from '@/src/analysis/nativeSamples';
import {type Lap} from '@/src/data/sessions';

// The start/finish wrap (pit-wall thread 27 #377): a lap is a loop, so
// before the line the charts show the previous lap's last metres, and after
// the lap's end the next lap's first metres. Only a contiguous neighbour
// counts: same stint and no pit between. Otherwise that side stays empty
// and is labelled, because a lap's own end drawn before its start would be a
// moment that never happened there (an out-lap came out of the pit lane).

export type Side =
  | {kind: 'lap'; lapId: string}
  | {kind: 'none'; label: 'pit' | 'start' | 'end'};

export type Neighbours = {before: Side; after: Side};

/** Metres of a neighbour drawn either side: more than the widest window. */
export const WRAP_M = 500;

export function lapNeighbours(laps: Lap[], lapId: string): Neighbours {
  const byIndex = new Map(laps.map(l => [l.lapIndex, l]));
  const lap = laps.find(l => l.id === lapId);
  if (!lap)
    return {
      before: {kind: 'none', label: 'start'},
      after: {kind: 'none', label: 'end'},
    };
  const prev = byIndex.get(lap.lapIndex - 1);
  const next = byIndex.get(lap.lapIndex + 1);
  const before: Side =
    lap.pitOut || (prev && (prev.pitIn || prev.stint !== lap.stint))
      ? {kind: 'none', label: 'pit'}
      : prev
      ? {kind: 'lap', lapId: prev.id}
      : {kind: 'none', label: 'start'};
  const after: Side =
    lap.pitIn || (next && (next.pitOut || next.stint !== lap.stint))
      ? {kind: 'none', label: 'pit'}
      : next
      ? {kind: 'lap', lapId: next.id}
      : {kind: 'none', label: 'end'};
  return {before, after};
}

/** A neighbour's last WRAP_M metres, placed before the line (negative m). */
export function tailBefore(s: NativeSamples, lengthM: number): NativeSamples {
  const distanceM: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < s.distanceM.length; i++) {
    const m = s.distanceM[i] - lengthM;
    if (m >= -WRAP_M && m < 0) {
      distanceM.push(m);
      values.push(s.values[i]);
    }
  }
  return {distanceM, values};
}

/** A neighbour's first WRAP_M metres, placed after the lap's end. */
export function headAfter(s: NativeSamples, lengthM: number): NativeSamples {
  const distanceM: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < s.distanceM.length; i++) {
    const m = s.distanceM[i];
    if (m > 0 && m <= WRAP_M) {
      distanceM.push(m + lengthM);
      values.push(s.values[i]);
    }
  }
  return {distanceM, values};
}
