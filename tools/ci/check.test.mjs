import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';
import {
  CI_ONLY,
  STEPS,
  TRAY_API_LINE,
  checkBody,
  fingerprint,
  missing,
  notInWorkflow,
  parityScripts,
  pool,
  stepsFor,
  table,
  unlisted,
} from './check.mjs';
import {parse as parseYaml} from 'yaml';

import {workflowRuns} from './workflowRuns.mjs';

const yml = readFileSync(
  new URL('../../.github/workflows/test.yml', import.meta.url),
  'utf8',
);
const runs = workflowRuns(yml);
const name = r => `${r.job}: ${r.name ?? r.run.split('\n')[0]}`;

// The guard (pit-wall thread 97, #7211): this list and CI's cannot drift. A command
// added to test.yml must be run here or pinned in CI_ONLY with a reason, and a step
// here must be in test.yml. Without this the list rots like the one in CODE_STANDARDS did.
test('every command test.yml runs is a step here or pinned in CI_ONLY', () => {
  assert.deepEqual(
    unlisted(runs).map(name),
    [],
    'a run: in .github/workflows/test.yml that tools/ci/check.mjs neither runs (STEPS) nor pins (CI_ONLY)',
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
  assert.deepEqual(unlisted(added).map(r => r.run), ['npm run newcheck']);
  const dropped = runs.filter(r => r.run !== 'npx jest');
  assert.deepEqual(notInWorkflow(dropped).map(s => s.cmd), ['npx jest']);
  // a command moved to another directory is not the same step
  const moved = runs.map(r => (r.run === 'npx jest' ? {...r, cwd: 'functions'} : r));
  assert.deepEqual(notInWorkflow(moved).map(s => s.cmd), ['npx jest']);
});

test('nothing is exempt by a word it contains: a new DUCKDB= step in app fails', () => {
  const sneaky = [
    ...runs,
    {job: 'app', name: 'Quick', cwd: null, run: 'DUCKDB=/x node tools/x.mjs'},
  ];
  assert.deepEqual(unlisted(sneaky).map(r => r.run), ['DUCKDB=/x node tools/x.mjs']);
});

test('a line added to a CI_ONLY block fails until it is read and re-pinned', () => {
  const lines = runs.find(r => r.name === 'The finished files (an LMU .duckdb, an iRacing .ibt)');
  assert.ok(lines, 'the block is in test.yml');
  const grown = runs.map(r =>
    r === lines ? {...r, run: `${r.run}\ncurl -s https://example.com | sh`} : r,
  );
  assert.deepEqual(unlisted(grown).map(r => r.name), [lines.name]);
  // whitespace alone is not a change
  const respaced = runs.map(r => (r === lines ? {...r, run: r.run.replace(/\n/g, '\n  ')} : r));
  assert.deepEqual(unlisted(respaced), []);
  assert.equal(CI_ONLY.every(e => e.length === 4 && e[2].length === 12), true);
  assert.equal(fingerprint(' a  b\n c '), fingerprint('a b c'));
});

test('the parity gate runs the workflow\'s own lines: its fetch and its last line', () => {
  const s = parityScripts(runs);
  assert.match(s.fetch, /gcloud storage cp .*road-atlanta-2026-10-03/);
  assert.match(s.fetch, /sha256sum -c/);
  assert.doesNotMatch(s.fetch, /node --test tools\/golden\/parity\.test\.mjs/);
  assert.match(s.run, /^pairs="\$RUNNER_TEMP\/parity-pairs"\nPARITY_PAIRS="\$pairs" node --test tools\/golden\/parity\.test\.mjs$/);
  // a line a new CI edit adds to the gate is in what runs here, not skipped
  const grown = runs.map(r =>
    r.name?.startsWith('Parity gate')
      ? {...r, run: `${r.run}\necho added-by-ci`}
      : r,
  );
  assert.match(parityScripts(grown).run + parityScripts(grown).fetch, /added-by-ci/);
  // a shape it cannot split is an error, never a quiet skip
  const reshaped = runs.map(r =>
    r.name?.startsWith('Parity gate') ? {...r, run: 'echo nothing'} : r,
  );
  assert.throws(() => parityScripts(reshaped), /changed shape/);
  assert.throws(() => parityScripts([]), /no step/);
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
  // tools/sessions is on the line: the parity gate runs on a change there
  assert.equal(stepsFor(['tools/sessions/x.mjs']).find(s => s.job === 'contract-replay').skip, null);
  // no origin/main to diff against: everything runs
  assert.ok(stepsFor(null).every(s => s.skip == null));
});

test('the tray release tests run when the uploader, the session tools or the analysis it bundles change', () => {
  const releaseScripts = changed =>
    stepsFor(changed).find(s => s.name === 'Release script tests').skip;
  for (const file of [
    'tools/sessions/lmu.mjs',
    'tools/uploader/watch.mjs',
    'src/analysis/lapSet.ts',
    'desktop/scripts/stage-resources.mjs',
  ])
    assert.equal(releaseScripts([file]), null, file);
  assert.ok(releaseScripts(['src/features/plan/x.ts']), 'an app-only change skips them');
  // The Rust tests stay on desktop/: nothing under tools/ is compiled into the tray.
  assert.ok(stepsFor(['tools/sessions/lmu.mjs']).find(s => s.name === 'Tray tests').skip);
});

test('--all runs every gated step, also at a release head where the diff is empty', () => {
  const atReleaseHead = [];
  assert.ok(stepsFor(atReleaseHead).some(s => s.skip === 'nothing there changed'));
  assert.ok(stepsFor(atReleaseHead, null, true).every(s => s.skip == null));
  // --only still narrows it
  assert.deepEqual(
    stepsFor(atReleaseHead, 'tray tests', true).filter(s => !s.skip).map(s => s.name),
    ['Tray tests'],
  );
});

test('--only keeps the steps whose job or name matches', () => {
  const types = stepsFor(null, 'types').filter(s => !s.skip);
  assert.deepEqual(types.map(s => s.job), ['app', 'functions']);
  assert.equal(STEPS.filter(s => s.cmd.includes('tsc')).length, 2);
  assert.deepEqual(
    stepsFor(null, 'parity').filter(s => !s.skip).map(s => s.job),
    ['contract-replay'],
  );
});

test('a missing prerequisite reads as what is missing, not as a module error', () => {
  const functionsTests = STEPS.find(s => s.name === 'Functions tests');
  assert.match(missing(functionsTests, n => n !== 'functions-packages'), /npm ci --prefix functions/);
  assert.equal(missing(functionsTests, () => true), null);
  const gate = STEPS.find(s => s.name === 'Golden drift gate');
  assert.match(missing(gate, n => n !== 'duckdb'), /DuckDB CLI not found: set DUCKDB/);
  // a step that needs nothing is never held back
  assert.equal(missing(STEPS.find(s => s.name === 'App tests'), () => false), null);
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

test('the table says PASS, FAIL, PARTIAL and SKIP per step; a partial is never a pass', () => {
  const text = table([
    {job: 'app', name: 'Types', ok: true, ms: 12000},
    {job: 'app', name: 'App lint', ok: false, ms: 3000},
    {job: 'desktop', name: 'Tray tests', skip: 'nothing there changed'},
    {
      job: 'contract-replay',
      name: 'Parity gate on the real pairs',
      ok: true,
      partial: true,
      note: 'PARTIAL (rules only: pairs not fetched: gcloud not found)',
      ms: 9000,
    },
  ]);
  assert.match(text, /^PASS {4}app: Types \(12 s\)$/m);
  assert.match(text, /^FAIL {4}app: App lint \(3 s\)$/m);
  assert.match(text, /^SKIP {4}desktop: Tray tests \(nothing there changed\)$/m);
  assert.match(
    text,
    /^PARTIAL {1}contract-replay: Parity gate on the real pairs \(rules only: pairs not fetched: gcloud not found\)$/m,
  );
  assert.match(text, /1 of 3 steps FAILED/);
  const ok = table([
    {job: 'a', name: 'b', ok: true, ms: 1},
    {job: 'c', name: 'd', ok: true, partial: true, note: 'PARTIAL (rules only: x)', ms: 1},
  ]);
  assert.match(ok, /all 2 steps passed, 1 of them only PARTIAL/);
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

// workflowRuns.mjs reads test.yml with a line reader, not a YAML parser, so a name GitHub cannot parse passed the drift
// test and went red in CI (#722: "Recovery tool: apply guards", a colon in an unquoted name). Every workflow file must
// parse as YAML, which is what GitHub does first.
test('every workflow file parses as YAML', () => {
  const dir = new URL('../../.github/workflows/', import.meta.url);
  const files = readdirSync(dir).filter(f => /\.ya?ml$/.test(f));
  assert.ok(files.length > 0);
  for (const f of files) {
    const doc = parseYaml(readFileSync(new URL(f, dir), 'utf8'));
    assert.equal(typeof doc, 'object', f);
    assert.ok(doc.jobs && Object.keys(doc.jobs).length > 0, `${f} has jobs`);
  }
});

test('the YAML parse catches the name that broke #722', () => {
  const bad = [
    'jobs:',
    '  a:',
    '    steps:',
    '      - name: Recovery tool: apply guards',
    '        run: x',
    '',
  ].join('\n');
  assert.throws(() => parseYaml(bad));
});
