// One-off: drop user references from the shared track documents.
// Tracks are app data. A track doc must not carry ownerId, a session id, or a
// list of the sessions it was built from. trackBoundaries keeps the result
// (starts, margin, rev) and drops its session map.
//
// Dry-run is the default. It prints one line per document it would change and
// writes nothing. --apply writes. Run it once, after this change is deployed.
//
//   node tools/sessions/stripTrackAppData.mjs
//   node tools/sessions/stripTrackAppData.mjs --apply

import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const DELETE = Symbol('delete');

/** admin.firestore.FieldValue. connect() does not return it. */
export function fieldValueFrom(admin) {
  const FieldValue = admin?.firestore?.FieldValue;
  if (typeof FieldValue?.delete !== 'function') {
    throw new Error(
      'firebase-admin FieldValue.delete is missing; --apply wrote nothing',
    );
  }
  return FieldValue;
}

/** Fields to remove from one tracks/{id} document. Values are DELETE or a replacement. */
export function trackUserRefPatch(data) {
  const patch = {};
  if (!data || typeof data !== 'object') return patch;
  if ('ownerId' in data) patch.ownerId = DELETE;
  if ('sessions' in data) patch.sessions = DELETE;
  if (
    data.source &&
    typeof data.source === 'object' &&
    'sessionId' in data.source
  ) {
    const source = {...data.source};
    delete source.sessionId;
    patch.source = Object.keys(source).length ? source : DELETE;
  }
  if (
    data.surface &&
    typeof data.surface === 'object' &&
    'sessions' in data.surface
  ) {
    const surface = {...data.surface};
    delete surface.sessions;
    patch.surface = surface;
  }
  return patch;
}

/** Fields to remove from one trackBoundaries/{id} document. */
export function boundaryUserRefPatch(data) {
  const patch = {};
  if (data && typeof data === 'object' && 'sessions' in data)
    patch.sessions = DELETE;
  return patch;
}

function describe(patch) {
  return Object.entries(patch)
    .map(([k, v]) => (v === DELETE ? `delete ${k}` : `rewrite ${k}`))
    .join(', ');
}

/**
 * db: Firestore. FieldValue: admin.firestore.FieldValue.
 * Returns the lines it would print. Writes only when apply is true.
 */
export async function stripTrackAppData({
  db,
  FieldValue,
  apply = false,
  log = console.log,
}) {
  if (apply && typeof FieldValue?.delete !== 'function') {
    throw new Error(
      'FieldValue.delete is missing, so --apply wrote nothing',
    );
  }
  const lines = [];
  const say = line => {
    lines.push(line);
    log(line);
  };
  const tracks = await db.collection('tracks').get();
  const boundaries = await db.collection('trackBoundaries').get();
  let changes = 0;
  for (const doc of tracks.docs) {
    const patch = trackUserRefPatch(doc.data());
    if (!Object.keys(patch).length) continue;
    changes += 1;
    say(`tracks/${doc.id}: ${describe(patch)}`);
    if (!apply) continue;
    const write = {};
    for (const [k, v] of Object.entries(patch))
      write[k] = v === DELETE ? FieldValue.delete() : v;
    await doc.ref.update(write);
  }
  for (const doc of boundaries.docs) {
    const patch = boundaryUserRefPatch(doc.data());
    if (!Object.keys(patch).length) continue;
    changes += 1;
    say(`trackBoundaries/${doc.id}: ${describe(patch)}`);
    if (!apply) continue;
    await doc.ref.update({sessions: FieldValue.delete()});
  }
  say(
    apply
      ? `applied ${changes} document(s)`
      : `dry-run: ${changes} document(s) would change. Re-run with --apply to write.`,
  );
  return lines;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const {connect} = await import('./store.mjs');
  const here = dirname(fileURLToPath(import.meta.url));
  const admin = createRequire(resolve(here, '../../functions/package.json'))(
    'firebase-admin',
  );
  const {db} = connect();
  await stripTrackAppData({
    db,
    FieldValue: fieldValueFrom(admin),
    apply: process.argv.includes('--apply'),
  });
}
