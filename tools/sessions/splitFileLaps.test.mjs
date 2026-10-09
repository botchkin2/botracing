import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assignSessionLapNumbers} from './splitFileLaps.mjs';

function nums(files, splitFiles) {
  return assignSessionLapNumbers(files, {splitFiles}).map(l => l.lapNumber);
}

test('iRacing two-file join: drop the continuation, keep the game numbers after it', () => {
  // File A ends in lap 5. File B's first piece is the rest of lap 5
  // (segments() stamps it with the next crossing, 6). Then the game's 6, 7.
  const files = [
    [
      {lapNumber: 1},
      {lapNumber: 2},
      {lapNumber: 3},
      {lapNumber: 4},
      {lapNumber: 5, partial: true},
    ],
    [
      {lapNumber: 6, partial: true},
      {lapNumber: 6},
      {lapNumber: 7},
    ],
  ];
  const assigned = assignSessionLapNumbers(files, {splitFiles: true});
  assert.deepEqual(
    assigned.map(l => l.lapNumber),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(new Set(assigned.map(l => l.lapNumber)).size, assigned.length);
  assert.deepEqual(
    assigned.filter(l => l.r === 1).map(l => l.lapNumber),
    [6, 7],
  );
});

test('iRacing lap counter that restarts in the next file stays monotonic', () => {
  const files = [
    [{lapNumber: 30}, {lapNumber: 31, partial: true}],
    [{lapNumber: 4, partial: true}, {lapNumber: 4}, {lapNumber: 5}],
  ];
  assert.deepEqual(nums(files, true), [30, 31, 32, 33]);
});

test('without splitFiles the numbers are what segments() wrote (LMU)', () => {
  const files = [
    [{lapNumber: 4}, {lapNumber: 5}, {lapNumber: 6, partial: true}],
    [{lapNumber: 6, partial: true}, {lapNumber: 6}, {lapNumber: 7}],
  ];
  assert.deepEqual(nums(files, false), [4, 5, 6, 6, 6, 7]);
});
