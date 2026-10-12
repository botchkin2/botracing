// Deletes whole sessions of one owner: the session document, the lap documents
// that still point at it, and the Storage objects that belong to it.
// Destructive, so it is built to be read first and run second (pit wall thread
// 1 #3959, bias #3960):
//
//   node tools/sessions/deleteSessions.mjs --owner UID --ids a,b,c [--sim iracing] [--archive]
//       dry run (default): prints exactly what would go and a hash of that set
//   node tools/sessions/deleteSessions.mjs --owner UID --ids a,b,c --apply --confirm HASH
//       recomputes the set, refuses if its hash is not the one that was shown
//
// What is touched, per id X and owner O, and nothing else:
//   sessions/X                                  last, so a crash leaves a handle to re-run
//   laps/*  with sessionId == X and ownerId == O
//   Storage prefixes bands/O/X/, field/O/X/, slices/O/X/, traces/O/<lapId>/
//   (and archive/<sim>/X/ with --archive: the parquet copy of every recording)
// Prefixes end in "/" so id `abc` never reaches `abcd`.
//
// Refused, before anything is deleted (the whole run is refused, not the id):
//   - the session document's ownerId is not --owner;
//   - the document is missing but something of it remains (laps or objects);
//   - the id is one the owner's folder groups into today (--sim): a stale or
//     mistyped list must never delete a session the current code produces.
// An id whose document, laps and objects are all gone is a no-op, so the same
// command can be run again after a failure or after success.
//
// What says an id is old: recordings. A recording's id does not change when the
// grouping does, and a resync overwrites `recordings/{id}` with the new
// sessionId; lap ids are `<sessionId>-NNN`, so old laps are never re-pointed.
// So while any recording of the owner still has sessionId == X, X is what the
// store calls that recording's session today (the resync is unfinished, or X is
// current): X is refused. The dry run prints the count (expected 0).
import {createHash} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

export const BATCH = 500;
const PREFIXES = ['bands', 'field', 'slices'];

/**
 * The prefixes of Storage objects that belong to session `id` of `owner`.
 * The archive has two layouts: the Admin sync writes archive/{sim}/{id}/, the
 * upload endpoint (the tray) writes archive/{ownerKey}/{sim}/{id}/ with
 * ownerKey = users/{uid}.ownerKey ?? uid (functions/src/uploadCore.ts).
 */
export function sessionPrefixes({owner, id, sim, archive, ownerKey}) {
  const out = PREFIXES.map(p => `${p}/${owner}/${id}/`);
  if (archive) {
    out.push(`archive/${sim ?? 'lmu'}/${id}/`);
    out.push(`archive/${ownerKey ?? owner}/${sim ?? 'lmu'}/${id}/`);
  }
  return out;
}

/**
 * What deleting `ids` would remove, or why it must not run.
 * backend: getDoc(path), listBySession(coll, sessionId, ownerId) (laps and
 *   recordings),
 *   listFiles(prefix) -> [{path, size}].
 * currentIds: ids the owner's folder groups into now (never deletable).
 */
export async function planDelete(
  backend,
  {owner, ids, currentIds = new Set(), archive = false},
) {
  const refusals = [];
  const sessions = [];
  const ownerKey = archive
    ? ((await backend.getDoc(`users/${owner}`))?.ownerKey ?? owner)
    : owner;
  for (const id of ids) {
    if (!/^[0-9a-f]{16}$/.test(id)) {
      refusals.push({id, why: 'not a session id (16 hex characters)'});
      continue;
    }
    if (currentIds.has(id)) {
      refusals.push({
        id,
        why: 'the owner’s folder groups into this id today: it is a current session, not an old one',
      });
      continue;
    }
    const doc = await backend.getDoc(`sessions/${id}`);
    if (doc && doc.ownerId !== owner) {
      refusals.push({
        id,
        why: `the session belongs to ${doc.ownerId ?? 'no owner'}, not ${owner}`,
      });
      continue;
    }
    // A recording still pointing here means this id is live (see the header).
    const recordings = (
      await backend.listBySession('recordings', id, owner)
    ).filter(r => r.data?.sessionId === id && r.data?.ownerId === owner);
    if (recordings.length) {
      refusals.push({
        id,
        why: `${recordings.length} recording(s) still point at this session: it is live, or the resync has not finished`,
      });
      continue;
    }
    // Only this owner's laps of this session, checked on the document itself.
    const laps = (await backend.listBySession('laps', id, owner)).filter(
      lap => lap.data?.sessionId === id && lap.data?.ownerId === owner,
    );
    const prefixes = sessionPrefixes({
      owner,
      id,
      sim: doc?.sim,
      archive,
      ownerKey,
    });
    for (const lap of laps) prefixes.push(`traces/${owner}/${lap.id}/`);
    const files = [];
    for (const prefix of prefixes) {
      for (const f of await backend.listFiles(prefix)) {
        // An exact prefix, whatever the store returned.
        if (f.path.startsWith(prefix))
          files.push({path: f.path, size: f.size ?? 0});
      }
    }
    if (!doc && (laps.length || files.length)) {
      refusals.push({
        id,
        why: `no session document, but ${laps.length} lap(s) and ${files.length} object(s) remain`,
      });
      continue;
    }
    sessions.push({
      id,
      doc: doc ? `sessions/${id}` : null,
      label: doc
        ? [doc.track?.name, doc.sessionType, doc.startedAt]
            .filter(Boolean)
            .join(' · ')
        : 'already gone',
      recordings: recordings.length,
      laps: laps.map(l => l.id).sort(),
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
    });
  }
  const plan = {owner, sessions, refusals};
  plan.hash = hashOf(plan);
  return plan;
}

/** A short hash of exactly what is to be deleted: ids, documents, objects. */
export function hashOf({owner, sessions}) {
  const h = createHash('sha256');
  h.update(`owner ${owner}\n`);
  for (const s of [...sessions].sort((a, b) => a.id.localeCompare(b.id))) {
    h.update(`session ${s.id} ${s.doc ?? '-'}\n`);
    for (const lap of s.laps) h.update(`lap ${lap}\n`);
    for (const f of s.files) h.update(`file ${f.path} ${f.size}\n`);
  }
  return h.digest('hex').slice(0, 16);
}

/** The plan as lines a person reads before saying yes. */
export function describePlan(plan) {
  const lines = [`owner ${plan.owner}`];
  for (const s of plan.sessions) {
    const bytes = s.files.reduce((a, f) => a + (f.size || 0), 0);
    lines.push(
      `${s.id}  ${s.label}`,
      `    recordings pointing here: ${s.recordings}   session doc: ${s.doc ?? 'none'}   lap docs: ${s.laps.length}   objects: ${s.files.length} (${(bytes / 1e6).toFixed(1)} MB)`,
    );
  }
  for (const r of plan.refusals) lines.push(`REFUSED ${r.id}: ${r.why}`);
  const nothing = plan.sessions.every(
    s => !s.doc && !s.laps.length && !s.files.length,
  );
  lines.push(`set hash ${plan.hash}${nothing ? '  (nothing to delete)' : ''}`);
  return lines;
}

/**
 * Deletes a plan. Refuses unless `confirm` is the hash of the set as it is
 * now. backend adds deleteDocs(paths) (batched here), deleteFile(path).
 * Returns the record of what was done.
 */
export async function applyDelete(
  backend,
  plan,
  {confirm, now = () => new Date()},
) {
  if (plan.refusals.length)
    throw new Error(
      `refused: ${plan.refusals.map(r => `${r.id} (${r.why})`).join('; ')}`,
    );
  if (confirm !== plan.hash)
    throw new Error(
      `the set to delete is ${plan.hash}, not ${confirm ?? 'the one given (--confirm)'}: run the dry run again and confirm what it shows`,
    );
  const record = {
    at: now().toISOString(),
    owner: plan.owner,
    hash: plan.hash,
    files: [],
    docs: [],
    failed: [],
  };
  // Objects first, then laps, then the session documents: a failure leaves the
  // session document, which is the handle the next run starts from.
  for (const s of plan.sessions) {
    for (const f of s.files) {
      try {
        await backend.deleteFile(f.path);
        record.files.push(f.path);
      } catch (error) {
        record.failed.push({
          path: f.path,
          error: String(error.message ?? error),
        });
      }
    }
  }
  if (record.failed.length) return record;
  const lapPaths = plan.sessions.flatMap(s => s.laps.map(l => `laps/${l}`));
  const sessionPaths = plan.sessions.filter(s => s.doc).map(s => s.doc);
  // A failed batch is recorded and stops the run; the session documents come
  // last, so what is left is still the handle for the next run.
  for (const paths of [lapPaths, sessionPaths]) {
    for (let i = 0; i < paths.length; i += BATCH) {
      const chunk = paths.slice(i, i + BATCH);
      try {
        await backend.deleteDocs(chunk);
        record.docs.push(...chunk);
      } catch (error) {
        record.failed.push({
          path: `${chunk.length} document(s) from ${chunk[0]}`,
          error: String(error.message ?? error),
        });
        return record;
      }
    }
  }
  return record;
}

/** The record, kept beside the run. */
export function writeRecord(dir, record) {
  mkdirSync(dir, {recursive: true});
  const name = `deleteSessions-${record.at.replace(/[:.]/g, '-')}.json`;
  const path = resolve(dir, name);
  writeFileSync(path, JSON.stringify(record, null, 1));
  return path;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
}

/** Ids the owner's folder produces now, for each sim asked (read-only). */
async function currentIdsOf(owner, sims) {
  const {adapter, telemetryFolder} = await import('./sims.mjs');
  const {groupFiles, scanFolder} = await import('./sessionFiles.mjs');
  const ids = new Set();
  for (const sim of sims) {
    const a = adapter(sim);
    const state = {files: {}, sessions: {}};
    const files = scanFolder({
      folder: telemetryFolder(sim),
      adapter: a,
      state,
      quietMin: 0,
    });
    for (const s of groupFiles(files, owner)) ids.add(s.id);
  }
  return ids;
}

async function main() {
  const owner = arg('--owner');
  const ids = (arg('--ids') ?? '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
  if (!owner || !ids.length) {
    console.error(
      'usage: deleteSessions.mjs --owner UID --ids a,b,c [--sim iracing] [--archive] [--apply --confirm HASH] [--log-dir DIR]',
    );
    process.exit(2);
  }
  const sims = arg('--sim', 'iracing').split(',');
  const {connect} = await import('./store.mjs');
  const {adminDeleteBackend} = await import('./deleteSessionsAdmin.mjs');
  const backend = adminDeleteBackend(connect());
  const plan = await planDelete(backend, {
    owner,
    ids,
    currentIds: await currentIdsOf(owner, sims),
    archive: process.argv.includes('--archive'),
  });
  for (const line of describePlan(plan)) console.log(line);
  if (!process.argv.includes('--apply')) {
    console.log(
      `dry run: nothing deleted. To delete exactly this set: add --apply --confirm ${plan.hash}`,
    );
    process.exit(plan.refusals.length ? 1 : 0);
  }
  const record = await applyDelete(backend, plan, {confirm: arg('--confirm')});
  const path = writeRecord(arg('--log-dir', join(tmpdir(), 'botracing-delete')), record);
  console.log(
    `deleted ${record.files.length} object(s), ${record.docs.length} document(s); ${record.failed.length} failed. Record: ${path}`,
  );
  if (record.failed.length) {
    for (const f of record.failed) console.log(`  failed ${f.path}: ${f.error}`);
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(
    process.argv[1].replace(/\\/g, '/').split('/').pop(),
  )
) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
