// The drift gate: a change to a golden session's expected numbers (or to which
// slice is pinned) is allowed, never silent. `update.mjs` rewrites the expected
// files and appends a stub to CHANGES.md; the stub says "Why: TODO". CI runs
// `node tools/golden/gate.mjs origin/main` and fails while a changed session has
// no entry added in the same change with a real sentence after "Why:".
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const MIN_WHY_WORDS = 5;

/** The session name of a path under tools/golden that is part of its numbers, else null. */
export function sessionOf(path) {
  const m = path.match(/^tools\/golden\/expected\/([^/]+)\.json$/);
  return m ? m[1] : null;
}

/**
 * Sessions whose expected numbers changed that have no explained entry.
 * `changedFiles`: paths changed against the base; `addedChanges`: the lines
 * this change added to CHANGES.md. An entry is "## <date> <session>" followed
 * by a "Why:" line with at least MIN_WHY_WORDS words that is not TODO.
 */
export function unexplained(changedFiles, addedChanges) {
  const changed = changedFiles.map(sessionOf).filter(Boolean);
  const explained = new Set();
  let current = null;
  for (const line of addedChanges) {
    const head = line.match(/^## \S+ (\S+)\s*$/);
    if (head) {
      current = head[1];
      continue;
    }
    const why = line.match(/^Why:\s*(.*)$/);
    if (why && current) {
      const words = why[1].trim().split(/\s+/).filter(Boolean);
      if (!/^TODO\b/i.test(why[1].trim()) && words.length >= MIN_WHY_WORDS)
        explained.add(current);
    }
  }
  return changed.filter(name => !explained.has(name));
}

function git(args) {
  return execFileSync('git', args, {encoding: 'utf8'});
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const base = process.argv[2] ?? 'origin/main';
  const range = `${base}...HEAD`;
  const changed = git(['diff', '--name-only', range, '--', 'tools/golden']).split('\n').filter(Boolean);
  const added = git(['diff', '--unified=0', range, '--', 'tools/golden/CHANGES.md'])
    .split('\n')
    .filter(l => l.startsWith('+') && !l.startsWith('+++'))
    .map(l => l.slice(1));
  const missing = unexplained(changed, added);
  if (missing.length) {
    console.error(
      `Golden numbers changed for ${missing.join(', ')} with no explained entry in tools/golden/CHANGES.md.\n` +
        'Run `node tools/golden/update.mjs`, then replace "Why: TODO" with the reason (at least five words).',
    );
    process.exit(1);
  }
  console.log(changed.length ? `golden drift explained (${changed.length} file(s) changed)` : 'golden: no change');
}
