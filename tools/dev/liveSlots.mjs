// Which folder a live-N dev server runs from (pit-wall thread 44 #1850).
// `.claude/launch.json` always starts from the main checkout, so a seat that
// wants to see its own branch claims a slot by writing one key to the
// gitignored `.claude/live-slots.local.json` in the main checkout:
//   {"1": "C:/Users/Botkin/Projects/garage61-session-analysis/.claude/worktrees/<seat>-<task>"}
// An unclaimed slot serves the main checkout. Pure: the file system comes in
// as `fs` so the node test needs none.
import path from 'node:path';

export const SLOT_COUNT = 6;
export const BASE_PORT = 19100;
export const SLOTS_FILE = path.join('.claude', 'live-slots.local.json');

/** The slot number from argv, 1 to SLOT_COUNT, or an Error naming what was wrong. */
export function parseSlot(arg) {
  const n = Number(arg);
  if (!Number.isInteger(n) || n < 1 || n > SLOT_COUNT)
    return new Error(`live: slot must be 1 to ${SLOT_COUNT}, got "${arg}"`);
  return n;
}

const same = (a, b) =>
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const inside = (dir, parent) => {
  const rel = path.relative(path.resolve(parent), path.resolve(dir));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * The folder slot `n` runs from, or an Error saying why not.
 * `fs`: {read(file) -> string | null, exists(path) -> boolean}.
 */
export function resolveSlot({root, slot, fs}) {
  const raw = fs.read(path.join(root, SLOTS_FILE));
  let claims = {};
  if (raw != null) {
    try {
      claims = JSON.parse(raw);
    } catch {
      return new Error(`live: ${SLOTS_FILE} is not valid JSON; fix or delete it`);
    }
    if (claims == null || typeof claims !== 'object' || Array.isArray(claims))
      return new Error(`live: ${SLOTS_FILE} must be an object like {"1": "<worktree path>"}`);
  }
  const claimed = claims[String(slot)];
  const dir = typeof claimed === 'string' && claimed !== '' ? claimed : root;
  if (!fs.exists(dir))
    return new Error(`live: slot ${slot} is claimed for ${dir}, which does not exist; remove the claim or recreate the worktree`);
  // Only this repo's own folders: the main checkout and its worktrees.
  const ok = same(dir, root) || inside(dir, path.join(root, '.claude', 'worktrees'));
  if (!ok)
    return new Error(`live: ${dir} is not the main checkout or one of its .claude/worktrees folders`);
  let cli = path.join(dir, 'node_modules', 'expo', 'bin', 'cli');
  if (!fs.exists(cli)) {
    // A worktree with no install borrows the main checkout's packages, but
    // only while its lockfile matches main's: a branch that changed
    // dependencies needs its own `npm ci`.
    if (same(dir, root))
      return new Error(`live: ${dir} has no node_modules (expo is missing). Run npm ci there; nothing is installed for you`);
    if (fs.read(lockOf(dir)) !== fs.read(lockOf(root)))
      return new Error(`live: ${dir} has no node_modules and its package-lock.json differs from main's (dependencies changed on this branch). Run npm ci in that worktree; nothing is installed for you`);
    cli = path.join(root, 'node_modules', 'expo', 'bin', 'cli');
    if (!fs.exists(cli))
      return new Error(`live: ${dir} has no node_modules and the main checkout has none either (expo is missing). Run npm ci in the main checkout's worktree of your own, not there; nothing is installed for you`);
  }
  return {dir, cli, claimed: !same(dir, root), port: BASE_PORT + slot};
}

const lockOf = dir => path.join(dir, 'package-lock.json');
