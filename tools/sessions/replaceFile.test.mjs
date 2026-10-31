// Run: node --test tools/sessions/
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
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

test('the data is flushed to disk before the rename', () => {
  const path = join(dir(), 'state.json');
  const order = [];
  replaceFile(path, '{"a":1}', {
    fsync: () => order.push('fsync'),
    rename: (a, b) => {
      order.push('rename');
      renameSync(a, b);
    },
  });
  assert.deepEqual(order, ['fsync', 'rename']);
  assert.equal(readFileSync(path, 'utf8'), '{"a":1}');
});

test('with backup, the file being replaced is kept as .bak when it is whole JSON', () => {
  const path = join(dir(), 'state.json');
  replaceFile(path, '{"v":1}', {backup: true});
  assert.equal(existsSync(`${path}.bak`), false, 'nothing to keep the first time');
  replaceFile(path, '{"v":2}', {backup: true});
  assert.equal(readFileSync(`${path}.bak`, 'utf8'), '{"v":1}');
  assert.equal(readFileSync(path, 'utf8'), '{"v":2}');
});

test('with backup, a file that is not JSON never overwrites the last good .bak', () => {
  const path = join(dir(), 'state.json');
  replaceFile(path, '{"v":1}', {backup: true});
  replaceFile(path, '{"v":2}', {backup: true});
  writeFileSync(path, ''); // a power cut left it empty
  replaceFile(path, '{"v":3}', {backup: true});
  assert.equal(readFileSync(`${path}.bak`, 'utf8'), '{"v":1}');
  assert.equal(readFileSync(path, 'utf8'), '{"v":3}');
});

test('a backup that cannot be made does not fail the write', () => {
  const path = join(dir(), 'state.json');
  replaceFile(path, '{"v":1}');
  replaceFile(path, '{"v":2}', {
    backup: true,
    copy: () => {
      throw new Error('EPERM');
    },
  });
  assert.equal(readFileSync(path, 'utf8'), '{"v":2}');
});
