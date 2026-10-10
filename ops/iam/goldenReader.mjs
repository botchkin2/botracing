// The golden set's CI reader, for an owner to run (Botkin: IAM grants and
// repo secrets are his). Dry run by default: prints what exists and the steps
// it would take, and changes nothing.
//
//   node ops/iam/goldenReader.mjs            dry run
//   node ops/iam/goldenReader.mjs --apply    creates the account, its prefix-only
//                                            read binding and the repo secret
//
// Needs gcloud logged in as an owner of botracing-61 and gh logged in as the
// repo owner. The key is written to a private temp folder, piped into
// `gh secret set` on stdin and deleted at once; it is never printed.
// Rules and why: goldenReaderPlan.mjs.
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {gcloudRunner} from './gcloud.mjs';
import {keyToSecret, runWithRetry} from './ciSplit.mjs';
import {GOLDEN, goldenEmail, hasGoldenBinding, planGoldenReader} from './goldenReaderPlan.mjs';

const gh = args => execFileSync('gh', args, {encoding: 'utf8'});

function tryOr(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function readState(run, g = GOLDEN, ghRun = gh) {
  const exists = tryOr(
    () => (run(['iam', 'service-accounts', 'describe', goldenEmail(g),
      `--project=${g.project}`, '--format=json']), true),
    false,
  );
  const bucketPolicy = tryOr(
    () => run(['storage', 'buckets', 'get-iam-policy', `gs://${g.bucket}`,
      `--project=${g.project}`, '--format=json']),
    null,
  );
  const secrets = String(tryOr(() => ghRun(['secret', 'list', '--repo', g.repo]), ''))
    .split('\n').map(l => l.split('\t')[0].trim());
  return {
    exists,
    bound: hasGoldenBinding(bucketPolicy, g),
    secretSet: secrets.includes(g.secret),
  };
}

export async function main(argv, {run = gcloudRunner(), ghRun = gh} = {}) {
  const apply = argv.includes('--apply');
  const state = readState(run, GOLDEN, ghRun);
  console.log(`${goldenEmail()}: ${state.exists ? 'exists' : 'not yet'}; ${GOLDEN.prefix}/-only read binding: ${state.bound ? 'yes' : 'no'}; repo secret ${GOLDEN.secret}: ${state.secretSet ? 'set' : 'not set'}`);
  const steps = planGoldenReader(state);
  console.log(`\n== ${steps.length} step(s)${apply ? '' : ' (dry run, nothing changes)'}`);
  for (const s of steps) {
    console.log(`  - ${s.what}`);
    if (!apply) continue;
    if (s.run) await runWithRetry(run, s.run);
    if (s.keyTo) keyToSecret(s.keyTo);
  }
  if (apply) console.log('\nDone. Re-run without --apply to check: it should list 0 steps.');
  else if (steps.length) console.log('\nRe-run with --apply to make these changes.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`STOP: ${error.message}`);
    process.exit(1);
  });
}
