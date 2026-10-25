// `npm run check`: what CI runs on a pull request, run here before the first push
// (pit-wall decisions/lap/2026-10-24-push-when-confident.md, ticket #48). A push
// that fails CI is a miss the builder reports; this is how a builder knows before.
//
// STEPS are the `run:` commands of .github/workflows/test.yml, verbatim, with the
// job and directory CI runs them in. check.test.mjs parses that file and fails when
// a command is in one place and not the other, so this cannot drift from CI the way
// the list in CODE_STANDARDS did. What cannot run on a PC (installs, a Linux binary,
// the emulators) is in CI_ONLY, pinned by step name and text, with the reason.
//
//   npm run check                 every step; one PASS/FAIL table at the end
//   npm run check -- --only tsc   steps whose job or name contains the text
//   npm run check -- --list       the steps and what gates them
//   npm run check -- --body f.md  the PR body f.md against the ship-proof check
//
// The table is plain text a PR body can carry. Output of a failed step is printed
// under it. Exit 1 when anything failed; a PARTIAL row (the parity gate without its
// real pairs) is not a pass and says why.
import {spawn, spawnSync, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {checkShipProof} from './shipProof.mjs';
import {workflowRuns} from './workflowRuns.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = join(root, '.github', 'workflows', 'test.yml');

// The same pattern as the workflow's "Anything on the tray/API line?" step.
export const TRAY_API_LINE =
  /^(desktop\/|functions\/|tools\/(uploader|sessions|dev|capture|golden)\/|src\/(analysis|data\/uploaders)\/|contract\/|firebase(\.emulator)?\.json$|\.github\/workflows\/test\.yml$)/;

/**
 * job and cwd as in the workflow; `when` is a path pattern: the step runs only when a
 * changed file matches; `before` is work a local run needs that CI does not; `needs` are
 * things that must be on this PC, checked first so a miss reads as what is missing.
 */
export const STEPS = [
  {job: 'app', name: 'Types', cwd: null, cmd: 'npx tsc --noEmit', before: 'router-types'},
  {job: 'app', name: 'App tests', cwd: null, cmd: 'npx jest'},
  {job: 'app', name: 'Tools - undefined names', cwd: null, cmd: 'npx eslint "tools/**/*.mjs"'},
  {job: 'app', name: 'App lint', cwd: null, cmd: 'npx eslint src app'},
  {
    job: 'app',
    name: 'Golden drift gate',
    cwd: null,
    cmd: 'node tools/golden/gate.mjs origin/main',
    needs: ['duckdb'],
  },
  {
    job: 'app',
    name: 'Uploader and session tools',
    cwd: null,
    cmd: 'node --test contract/*.test.mjs tools/golden/*.test.mjs tools/sessions/*.test.mjs tools/curate/*.test.mjs tools/uploader/*.test.mjs tools/ci/*.test.mjs tools/dev/*.test.mjs ops/backups/*.test.mjs ops/iam/*.test.mjs scripts/*.test.mjs',
    needs: ['duckdb'],
  },
  {
    job: 'functions',
    name: 'Types',
    cwd: 'functions',
    cmd: 'npx tsc --noEmit',
    needs: ['functions-packages'],
  },
  {
    job: 'functions',
    name: 'Functions tests',
    cwd: null,
    cmd: 'node --test functions/test/*.test.mjs',
    needs: ['functions-packages'],
  },
  {
    job: 'capture',
    name: 'Recorder tests',
    cwd: 'tools/capture',
    cmd: 'uv run --locked --group dev pytest -q',
    when: /^tools\/capture\//,
  },
  {
    job: 'capture',
    name: 'Recovery tool tests',
    cwd: 'tools/recover',
    cmd: 'uv run --with numpy --with pytest pytest -q',
    when: /^tools\/recover\//,
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

// The tray/API line also runs the parity gate on the REAL pairs, fetched the way CI's
// contract-replay job fetches them: its own two steps ("The capture" and the gate's fetch
// lines) run verbatim in Git Bash with RUNNER_TEMP set to a cache folder, once; then the
// gate's last line runs with PARITY_PAIRS (#739 was red on the pairs, not on the rules).
// When the pairs cannot be fetched the row says PARTIAL, never PASS.
export const CAPTURE_STEP = 'The capture (Road Atlanta 3 Oct, 3 laps)';
export const PARITY_NAME = 'Parity gate (capture vs game file, the same drive)';
export const PARITY_STEP = {
  job: 'contract-replay',
  name: 'Parity gate on the real pairs',
  cwd: null,
  cmd: 'node --test tools/golden/parity.test.mjs',
  blocks: [CAPTURE_STEP, PARITY_NAME],
  kind: 'parity',
  needs: ['duckdb'],
  when: TRAY_API_LINE,
};

/** A command's words, whitespace aside, as a short hash: what tells one run: from another. */
export const fingerprint = text =>
  createHash('sha1').update(text.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12);

/**
 * What test.yml runs that this does not: [job, step name (or the command when it has
 * none), fingerprint of the command text, why]. Pinned by name AND text: a changed or
 * added line in one of these fails the drift test until it is read and re-pinned here.
 * Nothing is exempt by a word it contains.
 */
export const CI_ONLY = [
  ['app', 'npm install', '494b8cb7fb2f', 'installs the packages (run npm ci once)'],
  ['app', 'DuckDB CLI (download)', 'bb5a996e3d6b', 'downloads the Linux DuckDB CLI; use your own'],
  ['app', 'DuckDB CLI (path)', '657022975af0', 'points DUCKDB at that download'],
  ['app', 'Golden set (require the slices)', '704538f1ccd5', 'makes a missing golden slice fail the run, CI only'],
  ['functions', 'npm ci --prefix functions', '5d2d99ccae69', 'installs the functions packages (run it once)'],
  ['functions', 'Functions build (engine bundle and Linux DuckDB)', 'd230c519dc9b', 'the deploy build: the Linux DuckDB and the engine bundle'],
  ['functions', 'API in the emulators', '4a45d182ce8a', 'the Firebase emulators and Java 21'],
  ['capture', 'DuckDB CLI', '810329774d27', 'downloads the Linux DuckDB CLI; use your own'],
  ['contract-replay', 'Anything on the tray/API line?', 'e6389d38a660', 'the scope step: this file gates on the same pattern (TRAY_API_LINE)'],
  ['contract-replay', 'Functions build', 'b54ab5407395', 'installs and builds the functions for the replay'],
  ['contract-replay', 'DuckDB CLI', '1b40681f0ee2', 'downloads the Windows DuckDB CLI; use your own'],
  ['contract-replay', 'The finished files (an LMU .duckdb, an iRacing .ibt)', '18238520dfe2', 'fetches the replay inputs from the private golden bucket'],
  ['contract-replay', 'Replay against the API in the emulators', 'a4c3328db05a', 'the replay against the API in the emulators (Java 21)'],
];

/** Every step to consider, the parity gate included. */
export const allSteps = () => [...STEPS, PARITY_STEP];

/**
 * Commands in `runs` (workflowRuns of test.yml) that nothing here covers: not a step's
 * command, not a block a step runs verbatim (the parity gate's two), and not a CI_ONLY
 * entry with the same job, name and text.
 */
export function unlisted(runs) {
  return runs.filter(r => {
    const inSteps = allSteps().some(
      s =>
        s.job === r.job &&
        ((r.run === s.cmd && (r.cwd ?? null) === (s.cwd ?? null)) ||
          (s.blocks ?? []).includes(r.name)),
    );
    const ciOnly = CI_ONLY.some(
      ([job, key, hash]) =>
        job === r.job && key === (r.name ?? r.run) && hash === fingerprint(r.run),
    );
    return !inSteps && !ciOnly;
  });
}

/** Steps here that test.yml does not run, in the same job and directory. */
export function notInWorkflow(runs) {
  return allSteps().filter(s => {
    if (s.blocks)
      return !s.blocks.every(name =>
        runs.some(r => r.job === s.job && r.name === name),
      );
    return !runs.some(
      r => r.job === s.job && r.run === s.cmd && (r.cwd ?? null) === (s.cwd ?? null),
    );
  });
}

/**
 * The parity gate's scripts, from test.yml's own text: `fetch` is the capture step and the
 * gate step less its last line; `run` is the gate's `pairs=` line and that last line.
 * Throws when the shape changes, so a change there is seen here and not skipped.
 */
export function parityScripts(runs) {
  const get = name => {
    const r = runs.find(x => x.job === PARITY_STEP.job && x.name === name);
    if (!r) throw new Error(`test.yml has no step "${name}" any more: update check.mjs`);
    return r.run;
  };
  const capture = get(CAPTURE_STEP);
  const gate = get(PARITY_NAME).split('\n');
  const testLine = gate.find(l => l.includes(PARITY_STEP.cmd));
  const pairsLine = gate.find(l => /^pairs=/.test(l));
  if (!testLine || !pairsLine)
    throw new Error(
      'the parity step in test.yml changed shape (no pairs= line or no gate line): update check.mjs',
    );
  return {
    fetch: [capture, ...gate.filter(l => l !== testLine)].join('\n'),
    run: `${pairsLine}\n${testLine}`,
  };
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

/** Where tools/sessions/duck.mjs looks for the CLI, then PATH. */
function hasOnThisPc(need) {
  if (need === 'functions-packages') return existsSync(join(root, 'functions', 'node_modules'));
  if (need === 'duckdb') {
    const candidates = [
      process.env.DUCKDB,
      join(root, 'tools', 'sessions', 'duckdb.exe'),
      process.env.LOCALAPPDATA &&
        join(process.env.LOCALAPPDATA, 'Temp', 'duckdb-cli', 'duckdb.exe'),
    ].filter(Boolean);
    if (candidates.some(c => existsSync(c))) return true;
    return spawnSync('duckdb', ['--version'], {shell: true}).status === 0;
  }
  return true;
}

const NEEDS_WORDS = {
  'functions-packages': 'functions packages missing: run `npm ci --prefix functions`',
  duckdb:
    'DuckDB CLI not found: set DUCKDB to duckdb.exe, or put it in %LOCALAPPDATA%\\Temp\\duckdb-cli (where tools/sessions/duck.mjs looks)',
};

/** The reason a step cannot run here, from what it needs; null when it can. `has` is injectable. */
export function missing(step, has = hasOnThisPc) {
  const need = (step.needs ?? []).find(n => !has(n));
  return need ? NEEDS_WORDS[need] : null;
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

/** One command, its output kept (never interleaved with the others'). */
function run(cmd, {cwd = root, shell = true, args = [], env = process.env} = {}) {
  return new Promise(done => {
    const started = Date.now();
    // args beside shell: true are only concatenated (Node's DEP0190): a shell command is one string
    const child = shell ? spawn(cmd, {cwd, shell, env}) : spawn(cmd, args, {cwd, shell, env});
    let output = '';
    child.stdout.on('data', d => (output += d));
    child.stderr.on('data', d => (output += d));
    child.on('error', error => done({ok: false, output: String(error), ms: Date.now() - started}));
    child.on('close', code => done({ok: code === 0, code, output, ms: Date.now() - started}));
  });
}

/** Git Bash (not WSL's bash.exe, which sits first on a Windows PATH). */
function bashPath() {
  if (process.platform !== 'win32') return 'bash';
  return [
    process.env.GIT_BASH,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ].find(p => p && existsSync(p));
}

/** The parity gate on the real pairs; PARTIAL (rules only, with the reason) when they cannot be had. */
async function runParity(step) {
  const started = Date.now();
  const rulesOnly = async reason => {
    const r = await run(step.cmd);
    return {
      ok: r.ok,
      partial: r.ok,
      note: r.ok ? `PARTIAL (rules only: ${reason})` : undefined,
      output: `${reason}\n${r.output}`,
      ms: Date.now() - started,
    };
  };
  let scripts;
  try {
    scripts = parityScripts(workflowRuns(readFileSync(WORKFLOW, 'utf8')));
  } catch (error) {
    return {ok: false, output: String(error.message), ms: Date.now() - started};
  }
  const bash = bashPath();
  if (!bash) return rulesOnly('pairs not fetched: Git Bash not found');
  if (spawnSync('gcloud', ['--version'], {shell: true}).status !== 0)
    return rulesOnly('pairs not fetched: gcloud not found');
  // RUNNER_TEMP is a cache folder, so the 100 MB of pairs are fetched once per version of the fetch lines.
  const cache = join(tmpdir(), 'botracing-check-parity');
  mkdirSync(cache, {recursive: true});
  const marker = join(cache, `.fetched-${fingerprint(scripts.fetch)}`);
  const env = {...process.env, RUNNER_TEMP: cache};
  const bashArgs = text => ({shell: false, args: ['-e', '-o', 'pipefail', '-c', text], env});
  if (!existsSync(marker)) {
    const fetched = await run(bash, bashArgs(scripts.fetch));
    if (!fetched.ok)
      return rulesOnly(
        `pairs not fetched: ${fetched.output.trim().split('\n').slice(-1)[0] || 'fetch failed'}`,
      );
    writeFileSync(marker, 'ok');
  }
  const r = await run(bash, bashArgs(scripts.run));
  return {ok: r.ok, output: r.output, ms: Date.now() - started};
}

async function runStep(step) {
  const reason = missing(step);
  if (reason) return {ok: false, output: reason, ms: 0};
  if (step.before === 'router-types') {
    // A live run writes .expo/types/router.d.ts, which fails tsc in a worktree (AGENTS.md).
    rmSync(join(root, '.expo', 'types'), {recursive: true, force: true});
  }
  if (step.kind === 'parity') return runParity(step);
  return run(step.cmd, {cwd: step.cwd ? join(root, step.cwd) : root});
}

/** Runs `tasks` (functions returning promises) at most `limit` at once; results in task order. */
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
const failed = row => !row.skip && !row.ok;

/** The table: one line per step, in step order. */
export function table(rows) {
  const lines = rows.map(row => {
    const state = row.skip ? 'SKIP' : row.partial ? 'PARTIAL' : row.ok ? 'PASS' : 'FAIL';
    const note = row.skip
      ? ` (${row.skip})`
      : row.partial
      ? ` ${row.note.replace(/^PARTIAL /, '')}`
      : row.ms != null
      ? ` (${seconds(row.ms)})`
      : '';
    return `${state}${' '.repeat(8 - state.length)}${row.job}: ${row.name}${note}`;
  });
  const bad = rows.filter(failed).length;
  const ran = rows.filter(row => !row.skip).length;
  const partial = rows.filter(row => row.partial).length;
  lines.push(
    '',
    bad
      ? `${bad} of ${ran} steps FAILED`
      : `all ${ran} steps passed${partial ? `, ${partial} of them only PARTIAL` : ''}`,
  );
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
  for (const row of rows.filter(r => failed(r) || r.partial)) {
    const log = join(tmp, `${row.job}-${row.name.replace(/\W+/g, '-')}.log`);
    writeFileSync(log, row.output ?? '');
    const tail = (row.output ?? '').trimEnd().split('\n').slice(-40).join('\n');
    console.log(`\n--- ${row.job}: ${row.name} (full output: ${log})\n${tail}`);
  }
  return rows.some(failed) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => process.exit(code));
}
