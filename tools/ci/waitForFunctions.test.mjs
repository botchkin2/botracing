import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {
  COMPARE_FILE_CAP,
  FUNCTIONS_PATHS,
  decide,
  followSuperseded,
  listRunsFor,
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

test('a file list at the compare API cap may be cut off, so it waits', () => {
  const app = n => Array.from({length: n}, (_, i) => `src/f${i}.ts`);
  assert.equal(touchesFunctions(app(COMPARE_FILE_CAP - 1)), false);
  assert.equal(touchesFunctions(app(COMPARE_FILE_CAP)), true);
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

// A queued run is cancelled when a newer one queues in the same concurrency group:
// a superseded run follows a later run on main that contains its commit.
const sha = (id, s) => ({...run(id, 'completed', s), sha: `sha${id}`});
const containsAll = () => true;

test('followSuperseded: A cancelled and B (a later run containing A) succeeded is green', () => {
  const runs = [sha(1, 'cancelled')];
  const later = [sha(1, 'cancelled'), sha(2, 'success')];
  assert.equal(decide(followSuperseded(runs, later, containsAll)), 'ok');
});

test('followSuperseded: A cancelled and B failed is red; B still running keeps waiting', () => {
  const runs = [sha(1, 'cancelled')];
  assert.equal(
    decide(followSuperseded(runs, [sha(2, 'failure')], containsAll)),
    'failed',
  );
  assert.equal(
    decide(followSuperseded(runs, [run(2, 'in_progress')], containsAll)),
    'wait',
  );
});

test('followSuperseded: A cancelled alone (stopped by hand) is red', () => {
  assert.equal(
    decide(
      followSuperseded(
        [sha(1, 'cancelled')],
        [sha(1, 'cancelled')],
        containsAll,
      ),
    ),
    'failed',
  );
});

test('followSuperseded: a later run that does not contain A is ignored; one cancelled again follows on', () => {
  const runs = [sha(1, 'cancelled')];
  const later = [sha(2, 'success')];
  assert.equal(decide(followSuperseded(runs, later, () => false)), 'failed');
  assert.equal(
    decide(
      followSuperseded(
        runs,
        [sha(2, 'cancelled'), sha(3, 'success')],
        containsAll,
      ),
    ),
    'ok',
  );
  // a run that is not cancelled is left alone
  const ok = [sha(1, 'success')];
  assert.deepEqual(followSuperseded(ok, [sha(2, 'failure')], containsAll), ok);
});

test('listRunsFor asks for the later runs and the compare only when the newest run of the commit was cancelled', () => {
  const calls = [];
  const gh = (...args) => {
    calls.push(args.slice(0, 2).join(' '));
    if (args[0] === 'api')
      return [args[1].endsWith('...shaB') ? 'ahead' : 'diverged'];
    if (args.includes('--commit'))
      return [
        {
          databaseId: 1,
          status: 'completed',
          conclusion: 'cancelled',
          headSha: 'shaA',
        },
      ];
    return [
      {
        databaseId: 2,
        status: 'completed',
        conclusion: 'success',
        headSha: 'shaB',
      },
      {
        databaseId: 3,
        status: 'completed',
        conclusion: 'success',
        headSha: 'shaC',
      },
    ];
  };
  const runs = listRunsFor({gh, repo: 'o/r', workflow: 'w.yml', sha: 'shaA'});
  assert.deepEqual(
    runs.map(r => r.id),
    [1, 2],
  );
  assert.deepEqual(calls, [
    'run list',
    'run list',
    'api repos/o/r/compare/shaA...shaB',
    'api repos/o/r/compare/shaA...shaC',
  ]);
  const plain = [];
  const ok = listRunsFor({
    gh: (...args) => {
      plain.push(args[0]);
      return [
        {
          databaseId: 1,
          status: 'completed',
          conclusion: 'success',
          headSha: 'shaA',
        },
      ];
    },
    repo: 'o/r',
    workflow: 'w.yml',
    sha: 'shaA',
  });
  assert.equal(ok.length, 1);
  assert.deepEqual(plain, ['run']);
});
