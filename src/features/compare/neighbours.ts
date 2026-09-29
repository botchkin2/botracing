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
  | {kind: 'none'; label: 'pit' | 'start' | 'end' | 'new file' | 'partial'};

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
  // A new recording file between two laps is a reset or a server drop:
  // the car did not drive from one into the other (pitlane, #70).
  const otherFile = (o: Lap) =>
    o.recordingId != null &&
    lap.recordingId != null &&
    o.recordingId !== lap.recordingId;
  const before: Side =
    lap.pitOut || (prev && (prev.pitIn || prev.stint !== lap.stint))
      ? {kind: 'none', label: 'pit'}
      : !prev
      ? {kind: 'none', label: 'start'}
      : otherFile(prev)
      ? {kind: 'none', label: 'new file'}
      : // A partial lap did not reach the line, so it has no tail there.
      prev.partial
      ? {kind: 'none', label: 'partial'}
      : {kind: 'lap', lapId: prev.id};
  const after: Side =
    lap.pitIn || (next && (next.pitOut || next.stint !== lap.stint))
      ? {kind: 'none', label: 'pit'}
      : !next
      ? {kind: 'none', label: 'end'}
      : otherFile(next)
      ? {kind: 'none', label: 'new file'}
      : {kind: 'lap', lapId: next.id};
  return {before, after};
}

/**
 * A neighbour's last WRAP_M metres, placed before the line (negative m).
 * `ownLengthM` is that lap's own distance at its last sample, so a lap a few
 * metres longer or shorter still meets the line at 0 (pitlane, #70).
 */
export function tailBefore(
  s: NativeSamples,
  ownLengthM: number,
): NativeSamples {
  const distanceM: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < s.distanceM.length; i++) {
    const m = s.distanceM[i] - ownLengthM;
    if (m >= -WRAP_M && m <= 0) {
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
