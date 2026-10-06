// Hosting must not go live before the functions it rewrites to exist: #274
// merged, both workflows ran at once, hosting finalized first and failed with
// a 404 on the new /api/upload rewrite, and the site kept serving the SPA for
// /api/upload/** until someone looked (pit wall thread 2, #105).
//
// Run by the hosting workflow before it deploys. If this push changed anything
// the functions workflow watches, wait for that workflow's run for the same
// commit and exit 1 unless it succeeded. If not, exit 0 straight away.
//
//   GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, BEFORE_SHA   (set by the workflow)
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const FUNCTIONS_WORKFLOW = 'firebase-functions-deploy.yml';

// The same paths as the `on.push.paths` of firebase-functions-deploy.yml; a
// test keeps them in step with the workflow file.
export const FUNCTIONS_PATHS = [
  /^functions\//,
  /^firestore\.rules$/,
  /^firestore\.indexes\.json$/,
  /^firebase\.json$/,
  /^\.github\/workflows\/firebase-functions-deploy\.yml$/,
];

export const touchesFunctions = files =>
  files.some(file => FUNCTIONS_PATHS.some(pattern => pattern.test(file)));

// What to do with the workflow runs listed for this commit:
//   'wait'    none yet, or the newest is still running
//   'ok'      the newest run succeeded
//   'failed'  the newest run finished without succeeding
export function decide(runs) {
  if (runs.length === 0) return 'wait';
  const newest = [...runs].sort((a, b) => b.id - a.id)[0];
  if (newest.status !== 'completed') return 'wait';
  return newest.conclusion === 'success' ? 'ok' : 'failed';
}

// listRuns() -> [{id, status, conclusion}] for the functions workflow at this
// commit. The run must appear within appearMs (a push event can lag) and
// finish within finishMs of starting to wait.
export async function waitForFunctions({
  listRuns,
  sleep = ms => new Promise(done => setTimeout(done, ms)),
  now = Date.now,
  pollMs = 15_000,
  appearMs = 5 * 60_000,
  finishMs = 25 * 60_000,
  log = console.log,
}) {
  const start = now();
  let seen = false;
  for (;;) {
    const runs = await listRuns();
    if (runs.length > 0) seen = true;
    const verdict = decide(runs);
    if (verdict === 'ok')
      return {ok: true, reason: 'functions deploy succeeded'};
    if (verdict === 'failed')
      return {
        ok: false,
        reason: 'the functions deploy for this commit did not succeed',
      };
    const waited = now() - start;
    if (!seen && waited > appearMs)
      return {
        ok: false,
        reason: `no functions deploy run appeared for this commit within ${
          appearMs / 60_000
        } min`,
      };
    if (waited > finishMs)
      return {ok: false, reason: 'the functions deploy did not finish in time'};
    log(
      seen
        ? 'functions deploy still running...'
        : 'waiting for the functions deploy to start...',
    );
    await sleep(pollMs);
  }
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
    files = ['functions/'];
  }
  if (!touchesFunctions(files)) {
    console.log(
      'This push changes nothing the functions workflow watches; not waiting.',
    );
    return 0;
  }
  console.log(
    'This push also changes functions or Firestore config; waiting for that deploy first.',
  );
  const result = await waitForFunctions({
    listRuns: async () =>
      gh(
        'run',
        'list',
        '--repo',
        repo,
        '--workflow',
        FUNCTIONS_WORKFLOW,
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
