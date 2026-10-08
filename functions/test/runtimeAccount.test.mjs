import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runtimeEmail} from '../../ops/iam/lib.mjs';

const src = name =>
  readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('the runtime account in the functions is the one the IAM audit and runbook name', () => {
  const [, email] = src('runtime.ts').match(/'(lap-runtime@[^']+)'/);
  assert.equal(email, runtimeEmail());
});

test('both functions run as it, and nothing else in src sets another account', () => {
  assert.match(
    src('lmuApi.ts'),
    /onRequest\(\s*\{serviceAccount: RUNTIME_ACCOUNT\}/,
  );
  assert.match(src('uploadApi.ts'), /serviceAccount: RUNTIME_ACCOUNT/);
  for (const file of ['lmuApi.ts', 'uploadApi.ts', 'index.ts'])
    assert.ok(
      !/serviceAccount:\s*['"`]/.test(src(file)),
      `${file} must use RUNTIME_ACCOUNT, not a literal`,
    );
});
