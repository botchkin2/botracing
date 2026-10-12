// Run: node --test tools/sessions/firstCrossing.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {firstCrossingT} from './analyze.mjs';

test('the first line crossing is when the lap counter first moves', () => {
  // Road Atlanta 25 Sep race: counter 0 at the start, 1 at 266.8 s.
  const laps = [
    {t: 17.1, v: 0},
    {t: 266.8, v: 1},
    {t: 390.1, v: 2},
  ];
  assert.equal(firstCrossingT(laps, 17.1), 266.8);
});

test('the counter state at the recording start is not a crossing', () => {
  assert.equal(firstCrossingT([{t: 100, v: 15}], 100), null);
  assert.equal(firstCrossingT([{t: 100.4, v: 15}], 100), null);
});

test('a file that starts mid-race crosses at its first counter change', () => {
  assert.equal(
    firstCrossingT([{t: 100, v: 15}, {t: 180, v: 16}], 100),
    180,
  );
});

test('no lap events: no crossing', () => {
  assert.equal(firstCrossingT([], 0), null);
  assert.equal(firstCrossingT(undefined, 0), null);
});
