// Stores a field rebuilt from a replay (tools/recover/vcrField.py) on its session, the way an upload does:
//   1. the gzip at gs://botracing-61-lmu/field/{owner}/{session}/{hash}.json.gz (hash = first 12 of sha1 of the JSON text,
//      as analyzeFromArchive names it; the file is content-addressed, so a re-run writes the same bytes),
//   2. the uploaded file is read back and its hash checked, and only then
//   3. the session doc's `field` pointer is set (and fieldMissing cleared) and analysis.v = 0, so the cloud analysis on
//      open works out result, classLaps, classBests and traffic from the stored field (the kept-field path of
//      store.mjs, stamped with the field's hash).
// DRY RUN by default: reads the session and prints every write it would make. Add --apply to write.
// Refuses unless the session is the one named, has no field yet, and matches what was checked: the start time and the
// kind (race, qualifying, practice) are required arguments, read off the replay and the results file, and must agree
// with the session doc; the field file must carry the alignment vcrField.py measured against the player's game file.
// node tools/recover/applyField.cjs --session <16 hex> --field field.json --expect-start <iso> --expect-type <R|Q|P> [--apply]
const fs = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

/** Throws when this field must not be written on this session doc; the guards of a repair, never a general overwrite. */
function checkSession({s, field, expectStart, expectType}) {
  if (s.field) throw new Error('the session already has a field: nothing to repair, refusing');
  if (s.supersededBy) throw new Error('the session is superseded: refusing');
  if (String(s.sessionType ?? '').charAt(0).toUpperCase() !== expectType)
    throw new Error(`the session is type ${s.sessionType}, not ${expectType}: refusing`);
  if (field.v !== 2 || field.hz !== 5 || !Array.isArray(field.cars) || field.cars.length < 2)
    throw new Error('not a field v2 file');
  if (!(Math.abs(Date.parse(s.startedAt) - Date.parse(expectStart)) <= 60_000))
    throw new Error(`the session starts at ${s.startedAt}, not within 60 s of ${expectStart}: refusing`);
  // The alignment is measured per field against the player's own game file (vcrField.py); a file without one was not.
  if (typeof field.alignM !== 'number' || !Number.isFinite(field.alignM))
    throw new Error(
      'the field file has no alignM (vcrField.py measures it against the game file of the player: run it with --game and --player): refusing',
    );
}

/** The session doc's `field` pointer for this file. */
function pointerOf({field, text, ownerId, sessionId}) {
  const hash = crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
  return {
    path: `field/${ownerId}/${sessionId}/${hash}.json.gz`,
    hash,
    hz: 5,
    cars: field.cars.length,
    durationS: Math.round(field.tDs[field.tDs.length - 1] / 10),
    captures: [],
    alignM: field.alignM,
    source: 'replay',
  };
}

module.exports = {checkSession, pointerOf};

async function main() {
  const arg = n => {
    const i = process.argv.indexOf(n);
    return i >= 0 ? process.argv[i + 1] : null;
  };
  const apply = process.argv.includes('--apply');
  const sessionId = arg('--session');
  const fieldFile = arg('--field');
  const expectStart = arg('--expect-start');
  const expectType = (arg('--expect-type') ?? '').toUpperCase();
  if (
    !/^[0-9a-f]{16}$/.test(sessionId ?? '') ||
    !fieldFile ||
    !Number.isFinite(Date.parse(expectStart ?? '')) ||
    !['R', 'Q', 'P'].includes(expectType)
  ) {
    console.error('usage: --session <16 hex> --field <field.json> --expect-start <iso time> --expect-type <R|Q|P> [--apply]');
    process.exit(2);
  }
  // firebase-admin lives in functions/node_modules (a worktree without its own install uses the main checkout's)
  let admin;
  try {
    admin = require('../../functions/node_modules/firebase-admin');
  } catch {
    admin = require('C:/Users/Botkin/Projects/garage61-session-analysis/functions/node_modules/firebase-admin');
  }
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: 'botracing-61',
    storageBucket: 'botracing-61-lmu',
  });
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  const ref = db.collection('sessions').doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`no session ${sessionId}`);
  const s = snap.data();
  const text = fs.readFileSync(fieldFile, 'utf8');
  const field = JSON.parse(text);
  console.log(`session ${sessionId}: owner ${s.ownerId}, ${s.sessionType}, ${s.startedAt} to ${s.endedAt}, ${s.lapCount} laps`);
  console.log(`  now: field ${JSON.stringify(s.field ?? null)}, fieldMissing ${JSON.stringify(s.fieldMissing ?? null)}, analysis.v ${s.analysis?.v}`);
  checkSession({s, field, expectStart, expectType});
  console.log(`  expected: type ${expectType}, start ${expectStart} (+-60 s); doc: type ${s.sessionType}, start ${s.startedAt}; alignM ${field.alignM} m (measured)`);

  const pointer = pointerOf({field, text, ownerId: s.ownerId, sessionId});
  const gz = zlib.gzipSync(Buffer.from(text, 'utf8'), {level: 9});
  console.log(`WOULD WRITE 1: gs://botracing-61-lmu/${pointer.path} (${gz.length} bytes gzip, ${text.length} bytes JSON, content-encoding gzip)`);
  console.log(`WOULD WRITE 2: sessions/${sessionId}: field = ${JSON.stringify(pointer)}; fieldMissing = null; analysis.v = 0`);
  console.log('  nothing else is touched: no lap, no recording, no other session.');
  if (!apply) {
    console.log('DRY RUN: nothing written. Add --apply to write.');
    return;
  }
  const file = bucket.file(pointer.path);
  await file.save(gz, {resumable: false, metadata: {contentType: 'application/json', contentEncoding: 'gzip', cacheControl: 'private, no-cache'}});
  // The file is read back and its hash checked BEFORE the doc points at it: a mismatch leaves the session as it was.
  const [back] = await file.download({decompress: false});
  const stored = crypto.createHash('sha1').update(zlib.gunzipSync(back)).digest('hex').slice(0, 12);
  if (stored !== pointer.hash)
    throw new Error(`the uploaded file hashes ${stored}, not ${pointer.hash}: the session was NOT changed (the file ${pointer.path} is left, unreferenced)`);
  console.log(`  uploaded file read back: hash ${stored} matches`);
  await ref.update({field: pointer, fieldMissing: null, 'analysis.v': 0});
  const after = (await ref.get()).data();
  console.log(`WRITTEN. session field ${JSON.stringify(after.field)}, analysis.v ${after.analysis?.v}`);
}

if (require.main === module) {
  main().catch(e => {
    console.error('ERR', e.message);
    process.exit(1);
  });
}
