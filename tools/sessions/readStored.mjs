// Reads stored documents from production Firestore (project botracing-61) and
// prints them as JSON lines, one per document. Read-only: it holds no write
// call, and readStored.test.mjs fails if one is added. Seats use it to prove a
// ticket on Botkin's stored data (pit-wall thread 100: "we are allowed to read
// data from production"); `.claude/settings.json` allows exactly this script.
//
// It imports only node built-ins and firebase-admin, so no other module can
// bring a write in behind the test.
//
//   node tools/sessions/readStored.mjs --collection sessions --owner LwTNOO0l \
//     --fields startedAt,sessionType,analysis.v,fieldMissing --sort startedAt
//   node tools/sessions/readStored.mjs --collection sessions --id a1b2,c3d4
//   node tools/sessions/readStored.mjs --collection laps --where sessionId=a1b2 \
//     --owner LwTNOO0l --fields lapNumber,lapTimeS
//
// Options (each may be given once; --id and --where may repeat):
//   --collection  top-level collection (required)
//   --owner       ownerId prefix: the documents whose ownerId starts with it
//   --id          document ids, comma-separated or repeated; no query runs
//   --where       field=value, equality on a string (e.g. sessionId=...)
//   --fields      comma-separated field paths to print (a.b for nested); the
//                 server sends only these. Omitted: whole documents
//   --sort        field, newest (largest) first; printed with the document
//   --limit       most documents printed (default 25; 0 = all)
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

export const PROJECT_ID = 'botracing-61';
export const DEFAULT_LIMIT = 25;

const NAME = /^[A-Za-z0-9_]+$/;
const FIELD_PATH = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

const SINGLE = ['collection', 'owner', 'fields', 'sort', 'limit'];
const REPEATED = ['id', 'where'];

/**
 * argv (after the script name) to the options this reader runs with.
 * Throws a message naming the bad argument.
 */
export function parseArgs(argv) {
  const seen = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!flag.startsWith('--'))
      throw new Error(`unexpected argument "${flag}"`);
    const key = flag.slice(2);
    if (!SINGLE.includes(key) && !REPEATED.includes(key))
      throw new Error(`unknown option "${flag}"`);
    if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
    if (key in seen && SINGLE.includes(key))
      throw new Error(`${flag} given twice`);
    (seen[key] ??= []).push(argv[i + 1]);
  }

  const collection = seen.collection?.[0];
  if (!collection) throw new Error('--collection is required');
  if (!NAME.test(collection))
    throw new Error(`--collection "${collection}" is not a collection name`);

  const ids = (seen.id ?? [])
    .flatMap(value => value.split(','))
    .filter(Boolean);
  for (const id of ids)
    if (id.includes('/'))
      throw new Error(`--id "${id}" holds a "/": ids are not paths`);

  const where = (seen.where ?? []).map(pair => {
    const at = pair.indexOf('=');
    const field = pair.slice(0, at);
    if (at < 1 || !FIELD_PATH.test(field))
      throw new Error(`--where "${pair}" is not field=value`);
    return {field, value: pair.slice(at + 1)};
  });

  const owner = seen.owner?.[0] ?? null;
  if (owner === '') throw new Error('--owner is empty');

  if (ids.length > 0 && (owner || where.length > 0))
    throw new Error(
      '--id reads those documents; it cannot combine with --owner or --where',
    );
  if (ids.length === 0 && !owner && where.length === 0)
    throw new Error(
      'give --id, --owner or --where: reading a whole collection is not allowed',
    );

  const fields = seen.fields ? seen.fields[0].split(',').filter(Boolean) : null;
  for (const field of fields ?? [])
    if (!FIELD_PATH.test(field))
      throw new Error(`--fields "${field}" is not a field path`);

  const sort = seen.sort?.[0] ?? null;
  if (sort && !FIELD_PATH.test(sort))
    throw new Error(`--sort "${sort}" is not a field path`);

  const limit = seen.limit ? Number(seen.limit[0]) : DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 0)
    throw new Error(`--limit "${seen.limit[0]}" is not a whole number`);

  return {collection, owner, ids, where, fields, sort, limit};
}

function valueAt(data, path) {
  let value = data;
  for (const key of path.split('.')) value = value?.[key];
  return value;
}

// The fields the server sends: the ones asked for, plus the sort field, which
// the client-side sort needs.
function maskOf({fields, sort}) {
  if (!fields) return null;
  return sort && !fields.includes(sort) ? [...fields, sort] : fields;
}

/**
 * Runs the read against `db` (a Firestore) and returns the rows to print:
 * `{id, ...data}` for each document, `{id, missing: true}` for an id with no
 * document. `db` is only asked for collection().doc/where/select/limit/get
 * and getAll.
 */
export async function readStored(db, options) {
  const {collection, owner, ids, where, sort, limit} = options;
  const mask = maskOf(options);
  const coll = db.collection(collection);

  if (ids.length > 0) {
    const refs = ids.map(id => coll.doc(id));
    const docs = mask
      ? await db.getAll(...refs, {fieldMask: mask})
      : await db.getAll(...refs);
    const rows = docs.map(doc =>
      doc.exists ? {id: doc.id, ...doc.data()} : {id: doc.id, missing: true},
    );
    return limit > 0 ? rows.slice(0, limit) : rows;
  }

  let query = coll;
  if (owner)
    query = query
      .where('ownerId', '>=', owner)
      .where('ownerId', '<', owner + '');
  for (const {field, value} of where) query = query.where(field, '==', value);
  if (mask) query = query.select(...mask);
  // A sort needs every match first (a server sort wants a composite index).
  if (!sort && limit > 0) query = query.limit(limit);

  const snap = await query.get();
  const rows = snap.docs.map(doc => ({id: doc.id, ...doc.data()}));
  if (sort) {
    rows.sort((a, b) =>
      String(valueAt(b, sort) ?? '').localeCompare(
        String(valueAt(a, sort) ?? ''),
      ),
    );
    return limit > 0 ? rows.slice(0, limit) : rows;
  }
  return rows;
}

function connect() {
  const require = createRequire(resolve(repoRoot, 'functions/package.json'));
  let admin;
  try {
    admin = require('firebase-admin');
  } catch {
    throw new Error(
      'firebase-admin is missing. Run: npm ci --prefix functions',
    );
  }
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: PROJECT_ID,
    });
  }
  return admin.firestore();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rows = await readStored(connect(), options);
  for (const row of rows) console.log(JSON.stringify(row));
  console.error(`${rows.length} document(s) from ${options.collection}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(error => {
    console.error(`readStored: ${error.message}`);
    process.exit(1);
  });
}
