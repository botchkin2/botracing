// Run: node --test tools/sessions/
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

import {replaceFile} from './replaceFile.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'replace-'));
const locked = code => Object.assign(new Error(code), {code});

test('replaces the file whole', () => {
  const path = join(dir(), 'state.json');
  replaceFile(path, '{"a":1}');
  replaceFile(path, '{"a":2}');
  assert.equal(readFileSync(path, 'utf8'), '{"a":2}');
});

test('a rename the OS refuses for a moment (a scanner holding the file) is tried again', () => {
  const path = join(dir(), 'state.json');
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    let refused = 3;
    const waits = [];
    replaceFile(path, `{"code":"${code}"}`, {
      rename: (a, b) => {
        if (refused-- > 0) throw locked(code);
        renameSync(a, b);
      },
      wait: ms => waits.push(ms),
    });
    assert.equal(readFileSync(path, 'utf8'), `{"code":"${code}"}`);
    assert.equal(waits.length, 3, code);
  }
});

test('a lock that never lets go still fails, after about a second; other errors at once', () => {
  const path = join(dir(), 'state.json');
  let waited = 0;
  assert.throws(
    () =>
      replaceFile(path, '{}', {
        rename: () => {
          throw locked('EPERM');
        },
        wait: ms => (waited += ms),
      }),
    /EPERM/,
  );
  assert.ok(waited >= 900 && waited <= 1100, `${waited} ms`);
  let tries = 0;
  assert.throws(
    () =>
      replaceFile(path, '{}', {
        rename: () => {
          tries++;
          throw locked('ENOSPC');
        },
        wait: () => {},
      }),
    /ENOSPC/,
  );
  assert.equal(tries, 1);
});
