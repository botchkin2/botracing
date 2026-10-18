import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mapLimit} from './mapLimit.mjs';

test('work is bounded: no more than the limit runs at once, and the order of results is kept', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([...Array(40).keys()], 5, async n => {
    running++;
    peak = Math.max(peak, running);
    await new Promise(r => setTimeout(r, 2));
    running--;
    return n * 2;
  });
  assert.equal(peak, 5);
  assert.deepEqual(
    out,
    [...Array(40).keys()].map(n => n * 2),
  );
  assert.deepEqual(await mapLimit([], 5, async n => n), []);
});
