// The `ship-proof` check (pit-wall thread 96 #6565, decision
// decisions/room/2026-10-20-apex-plans-before-it-acts.md item J): a PR that
// reaches where Botkin uses the app (his phone, the tray on his rig) must
// carry proof from there, in its body. Separate from review: #701 reached his
// phone with its device half unproven while every reviewer agreed.
//
// Paths decide, so an author cannot opt out. The check proves the proof is
// present and names a commit of this PR; the reviewer still opens the artifact
// and checks it ran at the head (docs/CODE_STANDARDS.md, section 11).
//
// CLI (.github/workflows/ship-proof.yml, pull_request_target so the base runs it):
//   BASE_SHA, HEAD_SHA, PR_BODY, PR_AUTHOR   (set by the workflow)
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const PROOF_HEADING = '## Proof where he uses it';

// Dependabot writes its own PR body, so it can never carry the section. Its
// PRs pass with a notice; the seat that takes one pushes a commit to the bump
// branch and adds the proof to the body, as for any PR (pit-wall thread 122).
// The login is GitHub's, not text a PR can set.
export const DEPENDABOT = 'dependabot[bot]';

// What reaches the phone: the OTA workflow's bundle inputs (ota-update.yml
// `paths`, a deny-list) minus what ships nothing. tools/track-info is there
// because src/data/tracks/catalog.ts imports its tracks.json.
const APP = [
  /^app\//,
  /^src\//,
  /^assets\//,
  /^tools\/track-info\//,
  /^(app|eas)\.json$/,
  /^package(-lock)?\.json$/,
  /^(babel|metro|fingerprint)\.config\.js$/,
];

// What reaches the tray on his rig: what desktop/scripts/stage-resources.mjs
// packs (tools/uploader, tools/sessions), the recorder (tools/capture) and the
// tray itself.
const TRAY = [/^desktop\//, /^tools\/(uploader|sessions|capture)\//];

// Exempt by path: docs, tests and fixtures prove nothing on a device, and a
// *.web.ts(x) file is bundled for the web only (its preview URL is the proof).
const EXEMPT = [
  /\.md$/,
  /^docs\//,
  /\.test\.(mjs|js|ts|tsx)$/,
  /(^|\/)test_[^/]*\.py$/,
  /(^|\/)(__fixtures__|__tests__|tests)\//,
  /\.web\.tsx?$/,
];

// The gate itself: a PR that edits the rule or its workflow needs proof too.
// (The workflow also runs the BASE copy of the rule, so a PR cannot pass
// itself by loosening it.) Reported as `reaches: 'gate'`.
const GATE = [/^\.github\/workflows\/ship-proof\.yml$/, /^tools\/ci\/shipProof(\.test)?\.mjs$/];

const matches = (patterns, path) => patterns.some(p => p.test(path));

/** Files of the diff that reach a device: [{path, reaches: 'app' | 'tray' | 'gate'}]. */
export function deviceFiles(paths) {
  const out = [];
  for (const path of paths) {
    if (matches(GATE, path)) {
      out.push({path, reaches: 'gate'});
      continue;
    }
    if (matches(EXEMPT, path)) continue;
    if (matches(APP, path)) out.push({path, reaches: 'app'});
    else if (matches(TRAY, path)) out.push({path, reaches: 'tray'});
  }
  return out;
}

/** The text under PROOF_HEADING, up to the next `## ` heading; null if absent.
 * HTML comments are dropped first, so the template's hint can't count. */
export function proofSection(body) {
  const text = (body ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const start = lines.findIndex(l => l.trim().toLowerCase() === PROOF_HEADING.toLowerCase());
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(l => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

/**
 * Decide the check. `commits` are the full shas of base..head in this PR;
 * `author` is the PR author's login.
 * Returns {ok, device, problems, notes}; `problems` is empty when ok.
 */
export function checkShipProof({files, body, commits, head, author = null}) {
  const device = deviceFiles(files);
  if (device.length === 0) {
    return {ok: true, device, problems: [], notes: ['No app, tray or gate code in the diff: exempt.']};
  }
  if (author === DEPENDABOT) {
    return {
      ok: true,
      device,
      problems: [],
      notes: ['A dependency bump: the seat that takes it adds the proof.'],
    };
  }
  const problems = [];
  const notes = [];
  const section = proofSection(body);
  if (section === null) {
    problems.push(`The PR body has no "${PROOF_HEADING}" section.`);
  } else {
    if (!/https?:\/\/[^\s)>\]]+/.test(section)) {
      problems.push('The proof section has no artifact link (http/https): an emulator screenshot or clip, or a rig or real-capture run log.');
    }
    const tokens = section.match(/\b[0-9a-f]{7,40}\b/gi) ?? [];
    const ran = tokens
      .map(t => t.toLowerCase())
      .map(t => commits.find(c => c.startsWith(t)))
      .find(Boolean);
    if (!ran) {
      problems.push('The proof section names no sha (7 to 40 hex) of a commit in this PR.');
    } else if (ran !== head) {
      notes.push(`The proof ran at ${ran.slice(0, 8)}, not the head ${head.slice(0, 8)}: re-run it, or say why the delta cannot matter.`);
    }
  }
  return {ok: problems.length === 0, device, problems, notes};
}

function git(...args) {
  return execFileSync('git', args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024})
    .split('\n')
    .filter(Boolean);
}

export function main(env = process.env) {
  const {BASE_SHA: base, HEAD_SHA: head, PR_BODY: body, PR_AUTHOR: author} = env;
  if (!base || !head) throw new Error('BASE_SHA and HEAD_SHA are required');
  // --no-renames: a moved file lists its old path too.
  const files = git('diff', '--name-only', '--no-renames', `${base}...${head}`);
  const commits = git('rev-list', `${base}..${head}`);
  const result = checkShipProof({files, body, commits, head, author});
  for (const note of result.notes) console.log(note);
  if (result.ok) return 0;
  const shown = result.device.slice(0, 10).map(f => `  ${f.reaches}: ${f.path}`);
  if (result.device.length > shown.length) shown.push(`  ... and ${result.device.length - shown.length} more`);
  console.error(`This PR reaches where he uses it:\n${shown.join('\n')}`);
  for (const p of result.problems) console.error(`- ${p}`);
  console.error(`Add the section to the PR body (editing it re-runs this check):\n\n${PROOF_HEADING}\n<artifact link> at <sha>\n`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
