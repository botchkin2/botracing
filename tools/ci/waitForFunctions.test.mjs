import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {
  FUNCTIONS_PATHS,
  decide,
  touchesFunctions,
  waitForFunctions,
} from './waitForFunctions.mjs';

const run = (id, status, conclusion = null) => ({id, status, conclusion});

test('a push that touches only the app does not wait', () => {
  assert.equal(
    touchesFunctions(['src/data/http.ts', 'app/settings.tsx']),
    false,
  );
});

test('functions, rules, indexes, firebase.json and the workflow itself do wait', () => {
  for (const file of [
    'functions/src/uploadApi.ts',
    'firestore.rules',
    'firestore.indexes.json',
    'firebase.json',
    '.github/workflows/firebase-functions-deploy.yml',
  ])
    assert.equal(touchesFunctions(['src/a.ts', file]), true, file);
  // Prefix lookalikes must not.
  assert.equal(
    touchesFunctions(['functions-notes.md', 'firestore.rules.md']),
    false,
  );
});

test('the paths match the functions workflow file', () => {
  const yml = readFileSync(
    new URL(
      '../../.github/workflows/firebase-functions-deploy.yml',
      import.meta.url,
    ),
    'utf8',
  );
  const paths = [...yml.matchAll(/^\s+- '([^']+)'$/gm)].map(m => m[1]);
  assert.ok(paths.length >= 4);
  for (const path of paths)
    assert.equal(
      touchesFunctions([path.replace('**', 'x')]),
      true,
      `${path} must be covered`,
    );
  assert.equal(FUNCTIONS_PATHS.length, paths.length);
});

test('decide: none or running waits; the newest run decides', () => {
  assert.equal(decide([]), 'wait');
  assert.equal(decide([run(1, 'in_progress')]), 'wait');
  assert.equal(decide([run(1, 'queued')]), 'wait');
  assert.equal(decide([run(1, 'completed', 'success')]), 'ok');
  assert.equal(decide([run(1, 'completed', 'failure')]), 'failed');
  assert.equal(decide([run(1, 'completed', 'cancelled')]), 'failed');
  // A re-run is a newer run: a failure followed by a success is ok, and the
  // other way round is not.
  assert.equal(
    decide([run(1, 'completed', 'failure'), run(2, 'completed', 'success')]),
    'ok',
  );
  assert.equal(
    decide([run(1, 'completed', 'success'), run(2, 'completed', 'failure')]),
    'failed',
  );
});

function clock() {
  let t = 0;
  return {now: () => t, sleep: async ms => void (t += ms)};
}

test('waits through queued and running, then passes on success', async () => {
  const answers = [
    [],
    [],
    [run(1, 'queued')],
    [run(1, 'in_progress')],
    [run(1, 'completed', 'success')],
  ];
  const result = await waitForFunctions({
    ...clock(),
    log: () => {},
    listRuns: async () => answers.shift(),
  });
  assert.equal(result.ok, true);
  assert.equal(answers.length, 0);
});

test('fails as soon as the functions deploy fails', async () => {
  const result = await waitForFunctions({
    ...clock(),
    log: () => {},
    listRuns: async () => [run(1, 'completed', 'failure')],
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /did not succeed/);
});

test('fails if the functions run never appears', async () => {
  const result = await waitForFunctions({
    ...clock(),
    log: () => {},
    appearMs: 60_000,
    listRuns: async () => [],
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no functions deploy run appeared/);
});

test('fails if the functions run never finishes', async () => {
  const result = await waitForFunctions({
    ...clock(),
    log: () => {},
    finishMs: 120_000,
    listRuns: async () => [run(1, 'in_progress')],
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /did not finish/);
});
