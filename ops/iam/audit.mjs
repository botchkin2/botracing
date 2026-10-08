// Read-only: is the runtime split in place?
//
//   node ops/iam/audit.mjs                                     prints the findings; exit 1 while a
//                                                              default account still has Editor or a
//                                                              function still runs as one
//   node ops/iam/audit.mjs --deploy-account <email>            also lists what the CI deploy account holds
//   node ops/iam/audit.mjs --json                              the same as data
//
// Changes nothing: it only runs `gcloud ... get-iam-policy`, `describe` and
// `list`. Needs gcloud logged in with read access (Viewer plus
// Security Reviewer, or an owner). Doubles as the standing check afterwards:
// run it next to ops/backups/status.mjs.
import {pathToFileURL} from 'node:url';
import {gatherState, gcloudRunner} from './gcloud.mjs';
import {CONFIG, evaluate, render} from './lib.mjs';

export function parseArgs(argv) {
  const out = {deployAccount: null, json: false};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--deploy-account') {
      out.deployAccount = argv[++i];
      if (!out.deployAccount || out.deployAccount.startsWith('--'))
        throw new Error('--deploy-account needs an email');
    } else throw new Error(`unknown option: ${a}`);
  }
  return out;
}

export function audit({
  run,
  deployAccount = null,
  config = CONFIG,
  log = console.log,
  json = false,
}) {
  const state = gatherState(run, config, {deployAccount});
  const result = evaluate(state, config);
  if (json) log(JSON.stringify(result, null, 2));
  else {
    log(`IAM audit of ${config.project}`);
    log(render(result));
    for (const message of state.notes) log(`note: gcloud said: ${message}`);
  }
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const result = audit({run: gcloudRunner(), ...args});
  process.exit(result.ok ? 0 : 1);
}
