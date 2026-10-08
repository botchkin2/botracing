import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {apiAuthHeaders} from './apiAuth.mjs';

test('no token file: no header', () => {
  assert.deepEqual(apiAuthHeaders({}), {});
});

test('the token file becomes a Bearer header, trimmed, read on every call', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'api-auth-')), 'token');
  writeFileSync(file, 'tok-1\n');
  const env = {LAP_TOKEN_FILE: file};
  assert.deepEqual(apiAuthHeaders(env), {authorization: 'Bearer tok-1'});
  writeFileSync(file, 'tok-2');
  assert.deepEqual(apiAuthHeaders(env), {authorization: 'Bearer tok-2'});
});

test('an empty token file sends no header', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'api-auth-')), 'token');
  writeFileSync(file, '  \n');
  assert.deepEqual(apiAuthHeaders({LAP_TOKEN_FILE: file}), {});
});

test('a missing token file is an error, not a silent anonymous call', () => {
  assert.throws(() =>
    apiAuthHeaders({LAP_TOKEN_FILE: join(tmpdir(), 'nope-x')}),
  );
});
