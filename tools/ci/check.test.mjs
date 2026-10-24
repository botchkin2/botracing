import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {
  CI_ONLY,
  STEPS,
  TRAY_API_LINE,
  notInWorkflow,
  unlisted,
  checkBody,
  pool,
  stepsFor,
  table,
} from './check.mjs';
import {workflowRuns} from './workflowRuns.mjs';

const yml = readFileSync(
  new URL('../../.github/workflows/test.yml', import.meta.url),
  'utf8',
);
const runs = workflowRuns(yml);

// The guard (pit-wall thread 97, #7211): this list and CI's cannot drift. A command
// added to test.yml must be run here or named in CI_ONLY with a reason, and a step
// here must be in test.yml. Without this the list rots like the one in CODE_STANDARDS did.
test('every command test.yml runs is a step here or named in CI_ONLY', () => {
  assert.deepEqual(
    unlisted(runs).map(r => `${r.job}: ${r.name ?? r.run.split('\n')[0]}`),
    [],
    'a run: in .github/workflows/test.yml that tools/ci/check.mjs neither runs (STEPS) nor lists with a reason (CI_ONLY)',
  );
});

test('every step here is a command test.yml runs, in the same job and directory', () => {
  assert.deepEqual(
    notInWorkflow(runs).map(s => `${s.job}: ${s.cmd}`),
    [],
  );
});

test('the guard fails on drift in either direction', () => {
  const added = [...runs, {job: 'app', name: 'New', cwd: null, run: 'npm run newcheck'}];
  assert.deepEqual(
    unlisted(added).map(r => r.run),
    ['npm run newcheck'],
  );
  const dropped = runs.filter(r => r.run !== 'npx jest');
  assert.deepEqual(
    notInWorkflow(dropped).map(s => s.cmd),
    ['npx jest'],
  );
  // a command moved to another directory is not the same step
  const moved = runs.map(r => (r.run === 'npx jest' ? {...r, cwd: 'functions'} : r));
  assert.deepEqual(
    notInWorkflow(moved).map(s => s.cmd),
    ['npx jest'],
  );
});

test('the tray/API line pattern is the one the workflow greps', () => {
  const scope = runs.find(r => r.name === 'Anything on the tray/API line?').run;
  const pattern = scope.match(/grep -qE '([^']+)'/)[1];
  assert.equal(TRAY_API_LINE.source.replace(/\\\//g, '/'), pattern);
});

test('a gated step runs only when a changed file is on its line; ungated steps always run', () => {
  const plan = stepsFor(['src/features/plan/x.ts']);
  const skipped = plan.filter(s => s.skip).map(s => `${s.job}:${s.name}`);
  assert.ok(skipped.some(n => n.startsWith('desktop:')));
  assert.ok(skipped.some(n => n.startsWith('capture:')));
  assert.ok(skipped.some(n => n.startsWith('contract-replay:')));
  assert.equal(plan.find(s => s.name === 'Types' && s.job === 'app').skip, null);
  const tray = stepsFor(['desktop/src-tauri/main.rs']);
  assert.equal(tray.find(s => s.name === 'Tray tests').skip, null);
  assert.equal(tray.find(s => s.job === 'contract-replay').skip, null);
  // no origin/main to diff against: everything runs
  assert.ok(stepsFor(null).every(s => s.skip == null));
});

test('--only keeps the steps whose job or name matches', () => {
  const types = stepsFor(null, 'types').filter(s => !s.skip);
  assert.deepEqual(
    types.map(s => s.job),
    ['app', 'functions'],
  );
  assert.equal(STEPS.filter(s => s.cmd.includes('tsc')).length, 2);
});

test('the pool never runs more than its limit at once and keeps the order of results', async () => {
  let live = 0;
  let peak = 0;
  const task = n => async () => {
    live++;
    peak = Math.max(peak, live);
    await new Promise(r => setTimeout(r, 5));
    live--;
    return n;
  };
  const out = await pool([1, 2, 3, 4, 5, 6].map(task), 2);
  assert.deepEqual(out, [1, 2, 3, 4, 5, 6]);
  assert.equal(peak, 2);
});

test('the table says PASS, FAIL and SKIP per step and counts the failures', () => {
  const text = table([
    {job: 'app', name: 'Types', ok: true, ms: 12000},
    {job: 'app', name: 'App lint', ok: false, ms: 3000},
    {job: 'desktop', name: 'Tray tests', skip: 'nothing there changed'},
  ]);
  assert.match(text, /^PASS {2}app: Types \(12 s\)$/m);
  assert.match(text, /^FAIL {2}app: App lint \(3 s\)$/m);
  assert.match(text, /^SKIP {2}desktop: Tray tests \(nothing there changed\)$/m);
  assert.match(text, /1 of 2 steps FAILED/);
  assert.match(table([{job: 'a', name: 'b', ok: true, ms: 1}]), /all 1 steps passed/);
});

test('--body runs the ship-proof check on the branch diff and the body file', () => {
  const sha = 'a'.repeat(40);
  const git = (...args) => {
    if (args[0] === 'merge-base') return ['b'.repeat(40)];
    if (args[0] === 'rev-parse') return [sha];
    if (args[0] === 'diff') return ['src/features/plan/model.ts'];
    if (args[0] === 'rev-list') return [sha];
    throw new Error(args.join(' '));
  };
  const withProof = checkBody('body.md', {
    git,
    read: () =>
      `## Proof where he uses it\nhttps://example.com/a.png at ${sha.slice(0, 8)}\n`,
  });
  assert.equal(withProof.ok, true);
  const without = checkBody('body.md', {git, read: () => '## What\nnothing\n'});
  assert.equal(without.ok, false);
  assert.match(without.problems[0], /no "## Proof where he uses it" section/);
});
