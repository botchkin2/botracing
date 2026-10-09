import assert from 'node:assert/strict';
import {test} from 'node:test';
import {run} from './curate.mjs';

const deps = {
  backend: {},
  adapter: {slug: () => 'x'},
  folder: '/none',
  workDir: '/tmp',
  now: () => '2026-10-09T00:00:00Z',
};

test('listing sessions without an owner is refused', async () => {
  const result = await run(['sessions'], deps);
  assert.equal(result.code, 1);
  assert.match(result.lines.join('\n'), /an owner is required/);
});

test('--owner is the owner the session list is grouped under', async () => {
  let seen = '';
  const result = await run(['sessions', '--owner', 'uid-test'], {
    ...deps,
    loader: {
      findSessions: ({ownerId}) => {
        seen = ownerId;
        return [];
      },
    },
  });
  assert.equal(result.code, 0);
  assert.equal(seen, 'uid-test');
});
