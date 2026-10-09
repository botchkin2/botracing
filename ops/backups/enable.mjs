// Turns on the backups (see lib.mjs for what and why).
//
//   node ops/backups/enable.mjs            dry run: reads the current state and
//                                          prints what it would run; changes nothing
//   node ops/backups/enable.mjs --apply    runs the steps that are not already done
//
// Safe to re-run: a step that is already in place is skipped. A step whose
// current state could not be read is refused unless --force (a second backup
// schedule would double the cost, and a failed read is not "not there").
// Needs `gcloud auth login` as an owner of the project.
import {pathToFileURL} from 'node:url';
import {gatherState, gcloudRunner} from './gcloud.mjs';
import {CONFIG, evaluateStatus, planEnable} from './lib.mjs';

export function parseArgs(argv) {
  const known = new Set(['--apply', '--force']);
  const flags = new Set();
  for (const a of argv) {
    if (!known.has(a)) throw new Error(`unknown option: ${a}`);
    flags.add(a);
  }
  return {apply: flags.has('--apply'), force: flags.has('--force')};
}

const shown = args => 'gcloud ' + args.join(' ');

export function enableBackups({
  run,
  apply = false,
  force = false,
  config = CONFIG,
  log = console.log,
}) {
  const before = gatherState(run, config);
  const steps = planEnable(before, config);
  let refused = 0;
  let ran = 0;
  for (const step of steps) {
    if (step.done) {
      log(`already set   ${step.title}`);
      continue;
    }
    if (!step.known && !force) {
      refused++;
      log(
        `CANNOT TELL   ${step.title}: the current state could not be read, so not changing it (use --force to go ahead)`,
      );
      continue;
    }
    log(
      `${apply ? 'running      ' : 'would run    '} ${
        step.title
      }\n              ${shown(step.args)}`,
    );
    if (apply) {
      run(step.args);
      ran++;
    }
  }
  if (!apply)
    log('\nDry run: nothing was changed. Add --apply to run the steps above.');
  const after = apply && ran > 0 ? gatherState(run, config) : before;
  const status = evaluateStatus(after, config);
  log('\n' + status.lines.join('\n'));
  // Just-enabled features show up as a first backup only after the first
  // scheduled run (up to a day), so a missing backup right after --apply is
  // expected, not a failure of this step.
  return {steps, ran, refused, status};
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const result = enableBackups({run: gcloudRunner(), ...opts});
    process.exit(result.refused > 0 ? 1 : 0);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
