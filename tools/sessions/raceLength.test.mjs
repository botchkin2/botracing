import assert from 'node:assert/strict';
import {test} from 'node:test';
import {raceLengthOf} from './raceLength.mjs';

test('the minutes from the green flag to the end time', () => {
  // The 3 Oct Road Atlanta race: green from 159.4 s, ends at 2559 s.
  assert.deepEqual(raceLengthOf({endEt: 2559, greenStartEt: 159.4}), {
    minutes: 40,
  });
  assert.deepEqual(raceLengthOf({endEt: 7370, greenStartEt: 170}), {
    minutes: 120,
  });
});

test('says nothing when the numbers do not say', () => {
  assert.equal(raceLengthOf({endEt: NaN, greenStartEt: 100}), null);
  assert.equal(raceLengthOf({endEt: 50, greenStartEt: 100}), null); // ends before the green
  assert.equal(raceLengthOf({endEt: NaN, greenStartEt: NaN}), null);
  // The game's "not set" end time (-2147483648) is not a length.
  assert.equal(raceLengthOf({endEt: -2147483648, greenStartEt: 100}), null);
});
