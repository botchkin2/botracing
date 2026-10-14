import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {CAUTION, yellowFlagOf} from './iracing.mjs';

// Real SessionFlags from the six .ibt recordings of the four sessions whose
// old yellow_flag was on (fixture header names each file and session).
const {recordings} = JSON.parse(
  readFileSync(new URL('./__fixtures__/iracingSessionFlags.json', import.meta.url), 'utf8'),
);
const LOCAL_YELLOW = 0x0008 | 0x0100;

test('real local-yellow SessionFlags (0x0008, 0x0100) map to yellow_flag 0', () => {
  let seen = 0;
  for (const rec of recordings) {
    for (const [flags] of rec.runs) {
      if (flags & CAUTION || !(flags & LOCAL_YELLOW)) continue;
      seen++;
      assert.equal(yellowFlagOf(flags), 0, `${rec.ibt} 0x${flags.toString(16)}`);
    }
  }
  assert.ok(seen > 0, 'the fixture holds local-yellow samples');
});

test('a real SessionFlags value with a caution bit set maps to yellow_flag 1', () => {
  // None of these recordings had a caution, so each real value is mutated by
  // one bit (caution 0x4000, then cautionWaving 0x8000), never hand-built.
  let checked = 0;
  for (const rec of recordings) {
    for (const [flags] of rec.runs) {
      for (const bit of [0x4000, 0x8000]) {
        assert.equal(yellowFlagOf(flags | bit), 1, `${rec.ibt} ${flags | bit}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 0);
});

test('none of these recordings had a full-course caution: yellow_flag never turns on', () => {
  for (const rec of recordings) {
    const on = rec.runs.filter(([flags]) => yellowFlagOf(flags)).length;
    assert.equal(on, 0, rec.ibt);
  }
});
