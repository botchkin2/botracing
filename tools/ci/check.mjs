// `npm run check`: what CI runs on a pull request, run here before the first push
// (pit-wall decisions/lap/2026-10-24-push-when-confident.md, ticket #48). A push
// that fails CI is a miss the builder reports; this is how a builder knows before.
//
// STEPS are the `run:` commands of .github/workflows/test.yml, verbatim, with the
// job and directory CI runs them in. check.test.mjs parses that file and fails when
// a command is in one place and not the other, so this cannot drift from CI the way
// the list in CODE_STANDARDS did. What cannot run on a PC (installs, a Linux binary,
// the emulators, the golden bucket) is in CI_ONLY with the reason.
//
//   npm run check                 every step; one PASS/FAIL table at the end
//   npm run check -- --only tsc   steps whose job or name contains "tsc"
//   npm run check -- --list       the steps and what gates them
//   npm run check -- --body f.md  the PR body f.md against the ship-proof check
//
// The table is plain text a PR body can carry. Output of a failed step is printed
// under it. Exit 1 when anything failed.
import {spawn, execFileSync} from 'node:child_process';
import {existsSync, readFileSync, rmSync, writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {checkShipProof} from './shipProof.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The same pattern as the workflow's "Anything on the tray/API line?" step.
export const TRAY_API_LINE =
  /^(desktop\/|functions\/|tools\/(uploader|sessions|dev|capture|golden)\/|src\/(analysis|data\/uploaders)\/|contract\/|firebase(\.emulator)?\.json$|\.github\/workflows\/test\.yml$)/;

/**
 * job and cwd as in the workflow; `when` is a path pattern: the step runs only when a
 * changed file matches (the workflow's own jobs for these are path-gated by hand or
 * by their own runner); `before` is work a local run needs that CI does not.
 */
export const STEPS = [
  {job: 'app', name: 'Types', cwd: null, cmd: 'npx tsc --noEmit', before: 'router-types'},
  {job: 'app', name: 'App tests', cwd: null, cmd: 'npx jest'},
  {job: 'app', name: 'Tools - undefined names', cwd: null, cmd: 'npx eslint "tools/**/*.mjs"'},
  {job: 'app', name: 'App lint', cwd: null, cmd: 'npx eslint src app'},
  {job: 'app', name: 'Golden drift gate', cwd: null, cmd: 'node tools/golden/gate.mjs origin/main'},
  {
    job: 'app',
    name: 'Uploader and session tools',
    cwd: null,
    cmd: 'node --test contract/*.test.mjs tools/golden/*.test.mjs tools/sessions/*.test.mjs tools/curate/*.test.mjs tools/uploader/*.test.mjs tools/ci/*.test.mjs tools/dev/*.test.mjs ops/backups/*.test.mjs ops/iam/*.test.mjs scripts/*.test.mjs',
  },
  {job: 'functions', name: 'Types', cwd: 'functions', cmd: 'npx tsc --noEmit'},
  {job: 'functions', name: 'Functions tests', cwd: null, cmd: 'node --test functions/test/*.test.mjs'},
  {
    job: 'capture',
    name: 'Recorder tests',
    cwd: 'tools/capture',
    cmd: 'uv run --locked --group dev pytest -q',
    when: /^tools\/capture\//,
  },
  {
    job: 'desktop',
    name: 'Tray tests',
    cwd: 'desktop',
    cmd: 'cargo test --manifest-path src-tauri/Cargo.toml',
    when: /^desktop\//,
  },
  {
    job: 'desktop',
    name: 'Release script tests',
    cwd: 'desktop',
    cmd: 'node --test scripts/*.test.mjs',
    when: /^desktop\//,
  },
];

// The tray/API line also runs the parity gate, on the real pairs when PARITY_PAIRS
// names them (CI's contract-replay job fetches them); without, its rules run and the
// pairs are skipped, and the table says so.
export const PARITY_STEP = {
  job: 'contract-replay',
  name: 'Parity gate (rules; real pairs only with PARITY_PAIRS)',
  cwd: null,
  cmd: 'node --test tools/golden/parity.test.mjs',
  when: TRAY_API_LINE,
};

/**
 * What test.yml runs that this does not, matched by a substring of the command:
 * [job, substring, why]. The drift test fails on any other command it finds.
 */
export const CI_ONLY = [
  ['app', 'npm install', 'installs the packages (run npm ci once; the table needs them)'],
  ['app', 'duckdb', 'downloads the Linux DuckDB CLI; set DUCKDB to your own'],
  ['app', 'GOLDEN_REQUIRED', 'makes a missing golden slice fail the run, CI only'],
  ['functions', 'npm ci --prefix functions', 'installs the functions packages (run it once)'],
  ['functions', 'npm run build', 'the deploy build: Linux DuckDB and the engine bundle'],
  ['functions', 'npm run test:emulator', 'the Firebase emulators and Java 21'],
  ['capture', 'duckdb', 'downloads the Linux DuckDB CLI; set DUCKDB to your own'],
  ['contract-replay', 'git diff --name-only', 'the scope step: check.mjs gates on the same pattern (TRAY_API_LINE)'],
  ['contract-replay', 'npm ci --prefix functions', 'installs and builds the functions for the replay'],
  ['contract-replay', 'duckdb', 'downloads the Windows DuckDB CLI; set DUCKDB to your own'],
  ['contract-replay', 'gcloud storage cp', 'fetches the golden recordings from the private bucket'],
  ['contract-replay', 'emulators.mjs', 'the replay against the API in the emulators (Java 21)'],
];

/** Every step to consider, the parity gate included. */
export const allSteps = () => [...STEPS, PARITY_STEP];

/** Commands in `runs` (workflowRuns of test.yml) that are neither a step here nor in CI_ONLY. */
export function unlisted(runs) {
  return runs.filter(r => {
    const inSteps = allSteps().some(s => s.job === r.job && r.run.includes(s.cmd));
    const ciOnly = CI_ONLY.some(
      ([job, part]) => job === r.job && r.run.toLowerCase().includes(part.toLowerCase()),
    );
    return !inSteps && !ciOnly;
  });
}

/** Steps here that test.yml does not run, in the same job and directory. */
export function notInWorkflow(runs) {
  return allSteps().filter(s => {
    // the parity gate is one line inside CI's multi-line step
    if (s === PARITY_STEP) return !runs.some(r => r.job === s.job && r.run.includes(s.cmd));
    return !runs.some(
      r => r.job === s.job && r.run === s.cmd && (r.cwd ?? null) === (s.cwd ?? null),
    );
  });
}

/** The steps that apply to a diff: a gated step runs only when a changed file matches. */
export function stepsFor(changed, only = null) {
  return allSteps().map(step => {
    const hit = !step.when || changed == null || changed.some(f => step.when.test(f));
    const wanted =
      only == null ||
      `${step.job} ${step.name}`.toLowerCase().includes(only.toLowerCase());
    return {...step, skip: !wanted ? 'not selected' : hit ? null : 'nothing there changed'};
  });
}

function git(...args) {
  return execFileSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024})
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
}

/** Files changed against origin/main, committed or not; null when there is no origin/main. */
export function changedFiles() {
  try {
    const base = git('merge-base', 'origin/main', 'HEAD')[0];
    return [
      ...new Set([
        ...git('diff', '--name-only', '--no-renames', base),
        ...git('ls-files', '--others', '--exclude-standard'),
      ]),
    ];
  } catch {
    return null;
  }
}

/** One step run: the output kept, never interleaved with the others'. */
function runStep(step) {
  return new Promise(done => {
    const started = Date.now();
    if (step.before === 'router-types') {
      // A live run writes .expo/types/router.d.ts, which fails tsc in a worktree (AGENTS.md).
      rmSync(join(root, '.expo', 'types'), {recursive: true, force: true});
    }
    const child = spawn(step.cmd, {
      cwd: step.cwd ? join(root, step.cwd) : root,
      shell: true,
      env: process.env,
    });
    let output = '';
    child.stdout.on('data', d => (output += d));
    child.stderr.on('data', d => (output += d));
    child.on('error', error => done({ok: false, output: String(error), ms: Date.now() - started}));
    child.on('close', code =>
      done({ok: code === 0, code, output, ms: Date.now() - started}),
    );
  });
}

/** Runs `tasks` (functions returning promises) at most `limit` at once, in order of start. */
export async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, tasks.length)}, worker));
  return results;
}

const seconds = ms => `${(ms / 1000).toFixed(0)} s`;

/** The table: one line per step, in step order. */
export function table(rows) {
  const lines = rows.map(r => {
    const state = r.skip ? 'SKIP' : r.ok ? 'PASS' : 'FAIL';
    const note = r.skip ? ` (${r.skip})` : r.ms != null ? ` (${seconds(r.ms)})` : '';
    return `${state}  ${r.job}: ${r.name}${note}`;
  });
  const failed = rows.filter(r => !r.skip && !r.ok).length;
  const ran = rows.filter(r => !r.skip).length;
  lines.push('', failed ? `${failed} of ${ran} steps FAILED` : `all ${ran} steps passed`);
  return lines.join('\n');
}

/** A PR body file against ship-proof, with the diff this branch has against origin/main. */
export function checkBody(bodyFile, now = {git, read: readFileSync}) {
  const base = now.git('merge-base', 'origin/main', 'HEAD')[0];
  const head = now.git('rev-parse', 'HEAD')[0];
  const files = now.git('diff', '--name-only', '--no-renames', `${base}...${head}`);
  const commits = now.git('rev-list', `${base}..${head}`);
  const body = now.read(bodyFile, 'utf8');
  return checkShipProof({files, body, commits, head});
}

export async function main(argv = process.argv.slice(2)) {
  const flag = name => argv.indexOf(name);
  if (flag('--body') >= 0) {
    const file = argv[flag('--body') + 1];
    if (!file || !existsSync(file)) {
      console.error('--body needs the PR body file');
      return 1;
    }
    const r = checkBody(file);
    for (const n of r.notes) console.log(n);
    for (const p of r.problems) console.error(`- ${p}`);
    console.log(r.ok ? 'ship-proof: ok' : 'ship-proof: FAIL');
    return r.ok ? 0 : 1;
  }
  const only = flag('--only') >= 0 ? argv[flag('--only') + 1] : null;
  const changed = changedFiles();
  const steps = stepsFor(changed, only);
  if (flag('--list') >= 0) {
    for (const s of steps)
      console.log(`${s.skip ? 'skip' : 'run '}  ${s.job}: ${s.name}  [${s.cwd ?? '.'}] ${s.cmd}`);
    return 0;
  }
  if (changed == null) console.log('No origin/main to diff against: running every step.');
  const tmp = mkdtempSync(join(tmpdir(), 'check-'));
  const jobs = Number(process.env.CHECK_JOBS) || 4;
  const results = await pool(
    steps.map(step => async () => (step.skip ? {skip: step.skip} : runStep(step))),
    jobs,
  );
  const rows = steps.map((step, i) => ({...step, ...results[i]}));
  console.log(table(rows));
  for (const r of rows.filter(row => !row.skip && !row.ok)) {
    const log = join(tmp, `${r.job}-${r.name.replace(/\W+/g, '-')}.log`);
    writeFileSync(log, r.output);
    const tail = r.output.trimEnd().split('\n').slice(-40).join('\n');
    console.log(`\n--- ${r.job}: ${r.name} (full output: ${log})\n${tail}`);
  }
  return rows.some(r => !r.skip && !r.ok) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => process.exit(code));
}
