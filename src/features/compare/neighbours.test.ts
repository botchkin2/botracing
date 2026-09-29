import {describe, expect, it} from '@jest/globals';

import {type Lap} from '@/src/data/sessions';

import {headAfter, lapNeighbours, tailBefore} from './neighbours';

const lap = (lapIndex: number, over: Partial<Lap> = {}): Lap => ({
  id: `L${lapIndex}`,
  lapIndex,
  timeS: 80,
  sectorsS: [],
  stint: 1,
  comparable: true,
  reasons: [],
  pitIn: false,
  pitOut: false,
  partial: false,
  offTrackS: 0,
  hadImpact: false,
  sections: [],
  recordingId: 'r1',
  endedInReset: false,
  ...over,
});

// L1 from the grid, L2–L3 flying, L4 into the pits, L5 out of them.
const laps = [
  lap(1),
  lap(2),
  lap(3),
  lap(4, {pitIn: true}),
  lap(5, {pitOut: true, stint: 2}),
  lap(6, {stint: 2}),
];

describe('lapNeighbours', () => {
  it('a flying lap wraps onto both neighbours', () => {
    expect(lapNeighbours(laps, 'L2')).toEqual({
      before: {kind: 'lap', lapId: 'L1'},
      after: {kind: 'lap', lapId: 'L3'},
    });
  });
  it('the first lap has nothing before it', () => {
    expect(lapNeighbours(laps, 'L1').before).toEqual({
      kind: 'none',
      label: 'start',
    });
  });
  it('an in-lap has no next lap, an out-lap no previous one', () => {
    expect(lapNeighbours(laps, 'L4').after).toEqual({
      kind: 'none',
      label: 'pit',
    });
    expect(lapNeighbours(laps, 'L5').before).toEqual({
      kind: 'none',
      label: 'pit',
    });
  });
  it('the lap before an in-lap still wraps onto it', () => {
    expect(lapNeighbours(laps, 'L3').after).toEqual({kind: 'lap', lapId: 'L4'});
  });
  it('the last lap has nothing after it', () => {
    expect(lapNeighbours(laps, 'L6').after).toEqual({
      kind: 'none',
      label: 'end',
    });
  });
});

describe('breaks inside a stint', () => {
  it('a new recording file is not contiguous', () => {
    const l = [lap(1), lap(2, {recordingId: 'r2'})];
    expect(lapNeighbours(l, 'L2').before).toEqual({
      kind: 'none',
      label: 'break',
    });
    expect(lapNeighbours(l, 'L1').after).toEqual({
      kind: 'none',
      label: 'break',
    });
  });
  it('a partial previous lap has no tail', () => {
    const l = [lap(1, {partial: true}), lap(2)];
    expect(lapNeighbours(l, 'L2').before).toEqual({
      kind: 'none',
      label: 'partial',
    });
  });
});

describe('tail and head', () => {
  const s = {distanceM: [0, 100, 3600, 3900, 3999], values: [1, 2, 3, 4, 5]};
  it('places the tail before the line', () => {
    expect(tailBefore(s, 4000)).toEqual({
      distanceM: [-400, -100, -1],
      values: [3, 4, 5],
    });
  });
  it('places the tail by the lap own length', () => {
    expect(tailBefore(s, 3999).distanceM).toEqual([-399, -99, 0]);
    expect(tailBefore(s, 3999).values).toEqual([3, 4, 5]);
  });
  it('places the head after the end', () => {
    expect(headAfter(s, 4000)).toEqual({distanceM: [4100], values: [2]});
  });
});
