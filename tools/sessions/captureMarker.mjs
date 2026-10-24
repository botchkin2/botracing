// "What this capture gave is in the store". After a sync uploads a session,
// every capture folder that session read (field, damage, race length, the
// player stream) gets <capture>/uploaded.json: {sessionId, sessionIds,
// uploadedUtc, verified}, with every session that used it. `verified` holds
// the sessions read back from the store and matching (verifyStored.mjs), by
// id. The tray's prune (desktop/src-tauri prune.rs) counts a capture as stored
// only when every session in sessionIds is verified; any other goes only at 14
// days, shown in Problems until then (pit-wall thread 100, L6, and Botkin's
// exception in decisions/lap/2026-10-21-no-validation-drops-data.md).
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import {resolve} from 'node:path';
import {capturesFor, listCaptures} from './field.mjs';
import {iracingCapturesFor, listIracingCaptures} from './irCapture.mjs';

export const MARKER = 'uploaded.json';

function previous(file) {
  try {
    const old = JSON.parse(readFileSync(file, 'utf8'));
    return {
      ids: Array.isArray(old.sessionIds) ? old.sessionIds : [old.sessionId],
      verified: old.verified ?? {},
    };
  } catch {
    return {ids: [], verified: {}};
  }
}

/**
 * Marks the named captures under `root` as uploaded for `sessionId`, with the
 * read-back `check` (verifyStored's result): a passed one is recorded under
 * verified, a failed or missing one removes that session's entry, so the
 * capture is kept. Returns the names marked; a folder that is gone (pruned,
 * moved) is skipped.
 */
export function markUploaded(
  root,
  names,
  sessionId,
  {check = null, now = new Date()} = {},
) {
  const marked = [];
  for (const name of names ?? []) {
    const dir = resolve(root, name);
    if (!existsSync(resolve(dir, 'meta.json'))) continue;
    const file = resolve(dir, MARKER);
    const tmp = `${file}.tmp`;
    // A capture can feed several sessions: every one that uploaded is listed
    // (sessionIds), the latest also as sessionId.
    const old = previous(file);
    const sessionIds = [...new Set([...old.ids, sessionId])];
    const verified = {...old.verified};
    if (check?.ok)
      verified[sessionId] = {
        laps: check.laps,
        fieldHash: check.fieldHash,
        utc: now.toISOString(),
      };
    else delete verified[sessionId];
    writeFileSync(
      tmp,
      JSON.stringify({
        sessionId,
        sessionIds,
        uploadedUtc: now.toISOString(),
        verified,
      }),
    );
    renameSync(tmp, file);
    marked.push(name);
  }
  return marked;
}

/**
 * The captures under `root` whose marker lists a session not yet verified,
 * as {name, sessionIds} (the unverified ones): a marker written before the
 * read-back existed, or one whose read-back failed.
 */
export function unverifiedMarks(root) {
  if (!root || !existsSync(root)) return [];
  const out = [];
  for (const name of readdirSync(root)) {
    const file = resolve(root, name, MARKER);
    if (!existsSync(file)) continue;
    const {ids, verified} = previous(file);
    const missing = ids.filter(id => id && !verified[id]);
    if (missing.length) out.push({name, sessionIds: missing});
  }
  return out;
}

/**
 * The captures live laps uploaded (the live index, liveSession.mjs: keys are
 * "<capture>#<stretch>") whose marker does not yet hold their sessions as
 * verified, as {name, sessionIds}. The live path writes no marker of its own,
 * so a drive uploaded live is read back here.
 */
export function liveMarks(root, liveIndex) {
  const byCapture = new Map();
  for (const [key, entry] of Object.entries(liveIndex ?? {})) {
    const name = key.split('#')[0];
    if (!entry?.sessionId || !existsSync(resolve(root, name, 'meta.json')))
      continue;
    if (!byCapture.has(name)) byCapture.set(name, new Set());
    byCapture.get(name).add(entry.sessionId);
  }
  const out = [];
  for (const [name, ids] of byCapture) {
    const {verified} = previous(resolve(root, name, MARKER));
    const missing = [...ids].filter(id => !verified[id]);
    if (missing.length) out.push({name, sessionIds: missing});
  }
  return out;
}

/**
 * Records a read-back for one session already in a capture's marker, leaving
 * its sessionId and uploadedUtc as they were. Returns whether it wrote.
 */
/**
 * Ids a read-back could not see because they are not in this owner's store.
 * Dropped only when another id on the same marker verified, so a marker that
 * also names another account (thread 100, a seat-test sync) can still count
 * as stored. A failure that is not "absent" stays: that id may be his.
 * `checks` are {id, ok, missing}.
 */
export function foreignMissing(checks) {
  if (!checks?.some(c => c.ok)) return [];
  return checks.filter(c => !c.ok && c.missing).map(c => c.id);
}

/**
 * Removes `ids` from one capture's marker. Leaves the file in place, and
 * leaves it unchanged when that would remove every session. uploadedUtc stays,
 * so the marker's clock does not move.
 */
export function dropSessionIds(root, name, ids) {
  const drop = new Set((ids ?? []).filter(Boolean));
  if (drop.size === 0) return false;
  const file = resolve(root, name, MARKER);
  if (!existsSync(file)) return false;
  const marker = JSON.parse(readFileSync(file, 'utf8'));
  const had = Array.isArray(marker.sessionIds)
    ? marker.sessionIds
    : marker.sessionId
      ? [marker.sessionId]
      : [];
  const sessionIds = had.filter(id => id && !drop.has(id));
  if (sessionIds.length === 0 || sessionIds.length === had.length) return false;
  const verified = {...(marker.verified ?? {})};
  for (const id of drop) delete verified[id];
  const sessionId = sessionIds.includes(marker.sessionId)
    ? marker.sessionId
    : sessionIds[sessionIds.length - 1];
  const tmp = `${file}.tmp`;
  writeFileSync(
    tmp,
    JSON.stringify({...marker, sessionId, sessionIds, verified}),
  );
  renameSync(tmp, file);
  return true;
}

export function markVerified(root, name, sessionId, check, now = new Date()) {
  const file = resolve(root, name, MARKER);
  if (!check?.ok || !existsSync(file)) return false;
  const marker = JSON.parse(readFileSync(file, 'utf8'));
  marker.verified = {
    ...marker.verified,
    [sessionId]: {
      laps: check.laps,
      fieldHash: check.fieldHash,
      utc: now.toISOString(),
    },
  };
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(marker));
  renameSync(tmp, file);
  return true;
}

/**
 * The names of the captures a session read: those of its sim whose track and
 * time overlap it. `span` is {tracks, startMs, endMs} as sync builds it.
 */
export function capturesRead(root, sim, span) {
  const found =
    sim === 'iracing'
      ? iracingCapturesFor(listIracingCaptures(root), {
          track: span.tracks[0],
          startMs: span.startMs,
          endMs: span.endMs,
        })
      : capturesFor(listCaptures(root), span);
  return found.map(c => c.name);
}
