import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

import {findSeatSignIn} from './assertNoSeatSignIn.mjs';

const tmp = files => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-'));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), {recursive: true});
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
};

test('a clean build has no hits', () => {
  assert.deepEqual(findSeatSignIn(tmp({'a.js': 'ok', 'sub/b.js': 'fine'})), []);
});

test('the endpoint path or the marker in any nested file is a hit', () => {
  const dir = tmp({'a.js': 'x', 'sub/b.js': 'fetch("/__seat-token")', 'c.js': '// DEV_SEAT_SIGNIN'});
  const hits = findSeatSignIn(dir);
  assert.equal(hits.length, 2);
});
