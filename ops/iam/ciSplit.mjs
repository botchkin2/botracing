// The CI identity split, for an owner to run (Botkin: IAM grants are his).
// Dry run by default: it prints who can do what now and the steps it would
// take, and changes nothing.
//
//   node ops/iam/ciSplit.mjs grant              dry run of phase 1 (only adds)
//   node ops/iam/ciSplit.mjs grant --apply      phase 1
//   ... merge the workflow PR, then prove: a PR preview deploys and a main
//   deploy succeeds on the new identities ...
//   node ops/iam/ciSplit.mjs revoke             dry run of phase 2 (only removes)
//   node ops/iam/ciSplit.mjs revoke --apply     phase 2
//
// Needs gcloud logged in as an owner of botracing-61 and gh logged in as the
// repo owner. A new key is written to a private temp folder, piped into
// `gh secret set` on stdin and deleted at once; it is never printed.
// Rules are in ciSplitPlan.mjs; why, and how to undo, in ops/iam/README.md.
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gcloudRunner} from './gcloud.mjs';
import {readPolicy} from './lib.mjs';
import {
  CI,
  ciRoles,
  hasReleaseBinding,
  planCiSplit,
  previewEmail,
  releaseEmail,
  secretReaders,
} from './ciSplitPlan.mjs';

const windows = process.platform === 'win32';
const gh = (args, opts = {}) =>
  execFileSync('gh', args, {encoding: 'utf8', ...opts});

function tryOr(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function readState(run, c = CI) {
  const {roles: policy} = readPolicy(
    run(['projects', 'get-iam-policy', c.project, '--format=json']),
  );
  const previewExists = tryOr(
    () => (run(['iam', 'service-accounts', 'describe', previewEmail(c),
      `--project=${c.project}`, '--format=json']), true),
    false,
  );
  const bucketPolicy = tryOr(() => run(['storage', 'buckets', 'get-iam-policy',
    `gs://${c.bucket}`, `--project=${c.project}`, '--format=json']), null);
  const releases = {};
  for (const r of c.releases)
    releases[r.name] = {
      exists: tryOr(
        () => (run(['iam', 'service-accounts', 'describe', releaseEmail(r, c),
          `--project=${c.project}`, '--format=json']), true),
        false,
      ),
      bound: hasReleaseBinding(bucketPolicy, r, c),
    };
  const keys = run(['iam', 'service-accounts', 'keys', 'list',
    `--iam-account=${c.deployEmail}`, `--project=${c.project}`,
    '--managed-by=user', '--format=json']) ?? [];
  const deployKeys = keys
    .sort((a, b) => String(a.validAfterTime).localeCompare(String(b.validAfterTime)))
    .map(k => k.name.split('/').pop());
  const names = out => new Set(
    String(out).split('\n').map(l => l.split('\t')[0].trim()).filter(Boolean));
  const envs = new Set(
    JSON.parse(tryOr(() => gh(['api', `repos/${c.repo}/environments`]), '{}'))
      .environments?.map(e => e.name) ?? []);
  const envSecrets = {};
  for (const env of [c.deployEnv, ...c.releases.map(r => r.env)])
    envSecrets[env] = envs.has(env)
      ? names(tryOr(() => gh(['secret', 'list', '--env', env, '--repo', c.repo]), ''))
      : new Set();
  const repoSecrets = names(gh(['secret', 'list', '--repo', c.repo]));
  const secrets = (run(['secrets', 'list', `--project=${c.project}`,
    '--format=json']) ?? []).map(s => s.name.split('/').pop());
  return {policy, previewExists, releases, deployKeys, envs, envSecrets, repoSecrets, secrets};
}

function report(state, run, c = CI, title) {
  console.log(`\n== ${title}`);
  for (const r of c.releases) {
    const now = state.releases[r.name];
    console.log(`  ${releaseEmail(r, c)}: ${now.exists ? 'exists' : 'not yet'}; ${r.prefix}/-only bucket binding: ${now.bound ? 'yes' : 'no'}`);
  }
  for (const [email, roles] of Object.entries(ciRoles(state.policy, c)))
    console.log(`  ${email}\n    ${roles.length ? roles.join('\n    ') : '(no project roles)'}`);
  console.log('  can read any secret (project level):');
  for (const r of secretReaders(state.policy)) console.log(`    ${r}`);
  for (const name of state.secrets) {
    const p = tryOr(() => run(['secrets', 'get-iam-policy', name,
      `--project=${c.project}`, '--format=json']), null);
    const extra = (p?.bindings ?? []).flatMap(b => b.members.map(m => `${m} (${b.role})`));
    console.log(`  secret ${name}: ${extra.length ? extra.join(', ') : 'no secret-level grants'}`);
  }
  console.log(`  repo secrets: ${[...state.repoSecrets].join(', ') || '-'}`);
  for (const [env, s] of Object.entries(state.envSecrets))
    console.log(`  ${env} secrets: ${[...s].join(', ') || (state.envs.has(env) ? '-' : '(no such Environment)')}`);
  console.log(`  deploy-account user keys: ${state.deployKeys.length}`);
}

// gcloud writes a key only to a file: a private temp folder, read once into
// `gh secret set` on stdin, deleted in `finally` whatever happens.
function keyToSecret({account, secret, env}, c = CI) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-key-'));
  const file = join(dir, 'key.json');
  try {
    const key = spawnSync(windows ? 'gcloud.cmd' : 'gcloud',
      ['iam', 'service-accounts', 'keys', 'create', file,
        `--iam-account=${account}`, `--project=${c.project}`],
      {shell: windows, encoding: 'utf8'});
    if (key.status !== 0) throw new Error(`key for ${account}: ${String(key.stderr).split('\n')[0]}`);
    const args = ['secret', 'set', secret, '--repo', c.repo, ...(env ? ['--env', env] : [])];
    const set = spawnSync('gh', args, {input: readFileSync(file)});
    if (set.status !== 0) throw new Error(`gh secret set ${secret}: ${String(set.stderr).split('\n')[0]}`);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

export async function main(argv, {run = gcloudRunner()} = {}) {
  const phase = argv[0];
  const apply = argv.includes('--apply');
  const before = readState(run);
  report(before, run, CI, 'now');
  const steps = planCiSplit(before, phase);
  console.log(`\n== ${phase}: ${steps.length} step(s)${apply ? '' : ' (dry run, nothing changes)'}`);
  for (const s of steps) {
    console.log(`  - ${s.what}`);
    if (!apply) continue;
    if (s.run) run(s.run);
    if (s.gh) gh(s.gh);
    if (s.then) gh(s.then);
    if (s.keyTo) keyToSecret(s.keyTo);
  }
  if (apply) report(readState(run), run, CI, 'after');
  else console.log('\nRe-run with --apply to make these changes.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`STOP: ${error.message}`);
    process.exit(1);
  });
}
