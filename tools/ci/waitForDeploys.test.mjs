import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

import {
  HOSTING_PATHS,
  HOSTING_WORKFLOW,
  expectedDeploys,
  touchesHosting,
  waitForDeploys,
} from './waitForDeploys.mjs';
import {FUNCTIONS_WORKFLOW} from './waitForFunctions.mjs';

const run = (id, status, conclusion = null) => ({id, status, conclusion});

test('an app-only push waits for hosting, a functions-only push for functions, both for both', () => {
  assert.deepEqual(expectedDeploys(['src/data/http.ts']), [HOSTING_WORKFLOW]);
  assert.deepEqual(expectedDeploys(['functions/src/dataApi.ts']), [FUNCTIONS_WORKFLOW]);
  assert.deepEqual(expectedDeploys(['src/data/http.ts', 'firebase.json']), [
    FUNCTIONS_WORKFLOW,
    HOSTING_WORKFLOW,
  ]);
  assert.deepEqual(expectedDeploys(['docs/API.md', 'tools/dev/live.mjs']), []);
});

test('the hosting paths match the hosting workflow file', () => {
  const yml = readFileSync(
    new URL('../../.github/workflows/firebase-hosting-merge.yml', import.meta.url),
    'utf8',
  );
  const paths = [...yml.matchAll(/^\s+- '([^']+)'$/gm)].map(m => m[1]);
  assert.ok(paths.length >= 10);
  for (const path of paths)
    assert.equal(touchesHosting([path.replace('**', 'x').replace('*', 'x')]), true, `${path} must be covered`);
  assert.equal(HOSTING_PATHS.length, paths.length);
});

test('waits until a workflow succeeded, then the next one', async () => {
  const calls = [];
  const answers = {
    [FUNCTIONS_WORKFLOW]: [[], [run(1, 'in_progress')], [run(1, 'completed', 'success')]],
    [HOSTING_WORKFLOW]: [[run(2, 'completed', 'success')]],
  };
  const result = await waitForDeploys({
    workflows: [FUNCTIONS_WORKFLOW, HOSTING_WORKFLOW],
    listRuns: async w => {
      calls.push(w);
      return answers[w].shift() ?? [];
    },
    sleep: async () => {},
    log: () => {},
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [FUNCTIONS_WORKFLOW, FUNCTIONS_WORKFLOW, FUNCTIONS_WORKFLOW, HOSTING_WORKFLOW]);
});

test('a failed deploy stops the wait and fails: the update stays unpublished', async () => {
  const result = await waitForDeploys({
    workflows: [FUNCTIONS_WORKFLOW, HOSTING_WORKFLOW],
    listRuns: async w =>
      w === FUNCTIONS_WORKFLOW ? [run(1, 'completed', 'failure')] : [run(2, 'completed', 'success')],
    sleep: async () => {},
    log: () => {},
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /firebase-functions-deploy/);
});

test('a run that never appears fails after the appear window', async () => {
  let t = 0;
  const result = await waitForDeploys({
    workflows: [HOSTING_WORKFLOW],
    listRuns: async () => [],
    sleep: async ms => {
      t += ms;
    },
    now: () => t,
    pollMs: 60_000,
    appearMs: 120_000,
    log: () => {},
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no firebase-hosting-merge/);
});
