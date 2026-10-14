// The live-lap analysis's grants, for an owner to run (Botkin: IAM grants are
// his). Dry run by default: prints what exists and the steps it would take,
// and changes nothing.
//
//   node ops/iam/liveAnalyze.mjs            dry run
//   node ops/iam/liveAnalyze.mjs --apply    adds the missing bindings
//
// Run it once before the merge that deploys liveAnalyze (the event receiver),
// and once after the deploy (the invoker on the new service). Needs gcloud
// logged in as an owner of botracing-61. Rules and why: liveAnalyzePlan.mjs.
import {pathToFileURL} from 'node:url';
import {gcloudRunner} from './gcloud.mjs';
import {runWithRetry} from './ciSplit.mjs';
import {INVOKER, LIVE, RECEIVER, grants, planLiveAnalyze} from './liveAnalyzePlan.mjs';

function tryOr(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function readState(run, l = LIVE) {
  const project = tryOr(
    () => run(['projects', 'get-iam-policy', l.project, '--format=json']),
    null,
  );
  // get-iam-policy answers an empty policy for a service that does not exist,
  // so whether it exists is asked on its own.
  const where = [`--region=${l.region}`, `--project=${l.project}`, '--format=json'];
  const serviceExists = tryOr(
    () => (run(['run', 'services', 'describe', l.service, ...where]), true),
    false,
  );
  const service = serviceExists
    ? tryOr(() => run(['run', 'services', 'get-iam-policy', l.service, ...where]), null)
    : null;
  return {
    receiver: grants(project, RECEIVER, l),
    serviceExists,
    invoker: grants(service, INVOKER, l),
  };
}

export async function main(argv, {run = gcloudRunner()} = {}) {
  const apply = argv.includes('--apply');
  const state = readState(run);
  console.log(`${LIVE.runtime}: event receiver ${state.receiver ? 'yes' : 'no'}; ${LIVE.service} service ${state.serviceExists ? 'exists' : 'not deployed yet'}; invoker on it ${state.invoker ? 'yes' : 'no'}`);
  const steps = planLiveAnalyze(state);
  console.log(`\n== ${steps.length} step(s)${apply ? '' : ' (dry run, nothing changes)'}`);
  for (const s of steps) {
    console.log(`  - ${s.what}`);
    if (apply && s.run) await runWithRetry(run, s.run);
  }
  if (apply) console.log('\nDone. Re-run without --apply to check.');
  else if (steps.some(s => s.run)) console.log('\nRe-run with --apply to make these changes.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`STOP: ${error.message}`);
    process.exit(1);
  });
}
