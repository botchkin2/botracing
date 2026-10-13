// An over-the-air Android update must not go out before the server it talks to
// exists. The OTA workflow publishes the new JS bundle the moment a push to
// main passes its checks; the functions and the hosting rewrites of the same
// push deploy in two other workflows and take minutes. The API rename (#591)
// is the case: the new bundle calls /api/sessions, which is a 404-by-SPA until
// `dataApi` and its Hosting rewrites are live, so a phone that launched in
// that window would show errors until the deploy finished.
//
// Run by the OTA workflow before it publishes. For this push's changed files:
// if the functions workflow watches any of them, wait for its run on the same
// commit; if the hosting workflow does, wait for that run too. Exit 1 unless
// every run that was expected succeeded (a failed deploy leaves the installed
// apps on the previous bundle, which the old routes still serve).
//
//   GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, BEFORE_SHA   (set by the workflow)
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

import {
  COMPARE_FILE_CAP,
  FUNCTIONS_WORKFLOW,
  decide,
  touchesFunctions,
} from './waitForFunctions.mjs';

export const HOSTING_WORKFLOW = 'firebase-hosting-merge.yml';

// The same paths as the `on.push.paths` of firebase-hosting-merge.yml (globs
// as regular expressions); a test keeps them in step with the workflow file.
export const HOSTING_PATHS = [
  /^app\//,
  /^src\//,
  /^assets\//,
  /^public\//,
  /^hooks\//,
  /^constants\//,
  /^tools\/track-info\/tracks\.json$/,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^app\.json$/,
  /^app\.config\.[^/]*$/,
  /^firebase\.json$/,
  /^metro\.config\.js$/,
  /^babel\.config\.js$/,
  /^tsconfig\.json$/,
  /^\.github\/workflows\/firebase-hosting-merge\.yml$/,
  /^tools\/ci\/waitForFunctions\.mjs$/,
];

export const touchesHosting = files =>
  files.length >= COMPARE_FILE_CAP ||
  files.some(file => HOSTING_PATHS.some(pattern => pattern.test(file)));

/**
 * Which deploy workflows a push should wait for, by changed files.
 * Returns the workflow file names, functions first (hosting rewrites to
 * functions, so the order is also the order they finish in).
 */
export function expectedDeploys(files) {
  return [
    ...(touchesFunctions(files) ? [FUNCTIONS_WORKFLOW] : []),
    ...(touchesHosting(files) ? [HOSTING_WORKFLOW] : []),
  ];
}

/**
 * Wait for each workflow's run on this commit. `listRuns(workflow)` gives
 * [{id, status, conclusion}]. A run must appear within appearMs and finish
 * within finishMs of starting to wait for that workflow.
 */
export async function waitForDeploys({
  workflows,
  listRuns,
  sleep = ms => new Promise(done => setTimeout(done, ms)),
  now = Date.now,
  pollMs = 15_000,
  appearMs = 5 * 60_000,
  finishMs = 25 * 60_000,
  log = console.log,
}) {
  for (const workflow of workflows) {
    const start = now();
    let seen = false;
    for (;;) {
      const runs = await listRuns(workflow);
      if (runs.length > 0) seen = true;
      const verdict = decide(runs);
      if (verdict === 'ok') {
        log(`${workflow}: succeeded`);
        break;
      }
      if (verdict === 'failed')
        return {ok: false, reason: `${workflow} did not succeed for this commit`};
      const waited = now() - start;
      if (!seen && waited > appearMs)
        return {
          ok: false,
          reason: `no ${workflow} run appeared for this commit within ${
            appearMs / 60_000
          } min`,
        };
      if (waited > finishMs)
        return {ok: false, reason: `${workflow} did not finish in time`};
      log(
        seen ? `${workflow} still running...` : `waiting for ${workflow} to start...`,
      );
      await sleep(pollMs);
    }
  }
  return {ok: true, reason: 'every deploy this push needs has succeeded'};
}

const gh = (...args) =>
  JSON.parse(execFileSync('gh', args, {encoding: 'utf8'}));

async function main(env = process.env) {
  const {GITHUB_REPOSITORY: repo, GITHUB_SHA: sha, BEFORE_SHA: before} = env;
  if (!repo || !sha)
    throw new Error('GITHUB_REPOSITORY and GITHUB_SHA are required');
  let files;
  if (before && !/^0+$/.test(before)) {
    files = gh(
      'api',
      `repos/${repo}/compare/${before}...${sha}`,
      '--jq',
      '[.files[].filename]',
    );
  } else {
    // A new branch or a forced push has no usable "before": be safe and wait.
    files = ['functions/', 'src/'];
  }
  const workflows = expectedDeploys(files);
  if (workflows.length === 0) {
    console.log('This push changes nothing a deploy workflow watches; not waiting.');
    return 0;
  }
  console.log(`Waiting for: ${workflows.join(', ')}`);
  const result = await waitForDeploys({
    workflows,
    listRuns: async workflow =>
      gh(
        'run',
        'list',
        '--repo',
        repo,
        '--workflow',
        workflow,
        '--commit',
        sha,
        '--json',
        'databaseId,status,conclusion',
      ).map(r => ({
        id: r.databaseId,
        status: r.status,
        conclusion: r.conclusion,
      })),
  });
  console.log(result.reason);
  return result.ok ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(await main());
}
