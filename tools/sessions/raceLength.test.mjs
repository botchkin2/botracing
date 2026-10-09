import assert from 'node:assert/strict';
import {test} from 'node:test';
import {NO_LAP_LIMIT, raceLengthOf} from './raceLength.mjs';

test('a race with no lap limit and an end time is timed: the minutes from the green flag', () => {
  // The 3 Oct Road Atlanta race: green from 159.4 s, ends at 2559 s.
  assert.deepEqual(
    raceLengthOf({maxLaps: NO_LAP_LIMIT, endEt: 2559, greenStartEt: 159.4}),
    {kind: 'timed', minutes: 40},
  );
  assert.deepEqual(
    raceLengthOf({maxLaps: NO_LAP_LIMIT, endEt: 7370, greenStartEt: 170}),
    {kind: 'timed', minutes: 120},
  );
});

test('a lap limit is a lap race, whatever the end time says', () => {
  assert.deepEqual(
    raceLengthOf({maxLaps: 30, endEt: 99999, greenStartEt: 100}),
    {kind: 'laps', laps: 30},
  );
});

test('says nothing when the numbers do not say', () => {
  const none = {maxLaps: NO_LAP_LIMIT, endEt: NaN, greenStartEt: 100};
  assert.equal(raceLengthOf(none), null);
  assert.equal(raceLengthOf({...none, endEt: 50}), null); // ends before the green
  assert.equal(raceLengthOf({maxLaps: NaN, endEt: NaN, greenStartEt: NaN}), null);
  // The game's "not set" end time (-2147483648) is not a length.
  assert.equal(
    raceLengthOf({maxLaps: NO_LAP_LIMIT, endEt: -2147483648, greenStartEt: 100}),
    null,
  );
});
