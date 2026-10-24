// Stores a field rebuilt from a replay (tools/recover/vcrField.py) on its session, the way an upload does:
//   1. the gzip at gs://botracing-61-lmu/field/{owner}/{session}/{hash}.json.gz (hash = first 12 of sha1 of the JSON text,
//      as analyzeFromArchive names it; the file is content-addressed, so a re-run writes the same bytes),
//   2. the session doc's `field` pointer (and fieldMissing cleared),
//   3. analysis.v = 0, so the cloud analysis on open works out result, classLaps, classBests and traffic from the stored
//      field (the kept-field path of store.mjs, stamped with the field's hash).
// DRY RUN by default: reads the session and prints every write it would make. Add --apply to write.
// Refuses unless the session is the one named, has no field yet, and matches what was checked.
// node tools/recover/applyField.cjs --session 73c538c310f179ae --field field.json [--apply]
const fs = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
// firebase-admin lives in functions/node_modules (a worktree without its own install uses the main checkout's)
let admin;
try {
  admin = require('../../functions/node_modules/firebase-admin');
} catch {
  admin = require('C:/Users/Botkin/Projects/garage61-session-analysis/functions/node_modules/firebase-admin');
}

const arg = n => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : null;
};
const apply = process.argv.includes('--apply');
const sessionId = arg('--session');
const fieldFile = arg('--field');
if (!/^[0-9a-f]{16}$/.test(sessionId ?? '') || !fieldFile) {
  console.error('usage: --session <16 hex> --field <field.json> [--apply]');
  process.exit(2);
}
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'botracing-61',
  storageBucket: 'botracing-61-lmu',
});
const db = admin.firestore();
const bucket = admin.storage().bucket();

(async () => {
  const ref = db.collection('sessions').doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`no session ${sessionId}`);
  const s = snap.data();
  const text = fs.readFileSync(fieldFile, 'utf8');
  const field = JSON.parse(text);
  const duration = Math.round(field.tDs[field.tDs.length - 1] / 10);
  console.log(`session ${sessionId}: owner ${s.ownerId}, ${s.sessionType}, ${s.startedAt} to ${s.endedAt}, ${s.lapCount} laps`);
  console.log(`  now: field ${JSON.stringify(s.field ?? null)}, fieldMissing ${JSON.stringify(s.fieldMissing ?? null)}, analysis.v ${s.analysis?.v}`);
  // Guards: this is a repair of one session, never a general overwrite.
  if (s.field) throw new Error('the session already has a field: nothing to repair, refusing');
  if (s.supersededBy) throw new Error('the session is superseded: refusing');
  if (!/^r/i.test(s.sessionType ?? '')) throw new Error('not a race: refusing');
  if (field.v !== 2 || field.hz !== 5 || !Array.isArray(field.cars) || field.cars.length < 2) throw new Error('not a field v2 file');
  const startMs = Date.parse(s.startedAt);
  if (Math.abs(startMs - Date.parse('2026-10-22T00:39:25Z')) > 60_000) throw new Error('the session does not start at the race of 2026-10-22T00:39:25Z: refusing');

  const hash = crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
  const dest = `field/${s.ownerId}/${sessionId}/${hash}.json.gz`;
  const gz = zlib.gzipSync(Buffer.from(text, 'utf8'), {level: 9});
  const pointer = {path: dest, hash, hz: 5, cars: field.cars.length, durationS: duration, captures: [], alignM: 0.6, source: 'replay'};
  console.log(`WOULD WRITE 1: gs://botracing-61-lmu/${dest} (${gz.length} bytes gzip, ${text.length} bytes JSON, content-encoding gzip)`);
  console.log(`WOULD WRITE 2: sessions/${sessionId}: field = ${JSON.stringify(pointer)}; fieldMissing = null; analysis.v = 0`);
  console.log('  nothing else is touched: no lap, no recording, no other session.');
  if (!apply) {
    console.log('DRY RUN: nothing written. Add --apply to write.');
    return;
  }
  const file = bucket.file(dest);
  await file.save(gz, {resumable: false, metadata: {contentType: 'application/json', contentEncoding: 'gzip', cacheControl: 'private, no-cache'}});
  // the doc follows the file, so a reader never sees a pointer to nothing
  await ref.update({field: pointer, fieldMissing: null, 'analysis.v': 0});
  const [back] = await file.download({decompress: false});
  const same = crypto.createHash('sha1').update(zlib.gunzipSync(back)).digest('hex').slice(0, 12) === hash;
  const after = (await ref.get()).data();
  console.log(`WRITTEN. read back: file hash ${same ? 'matches' : 'DIFFERS'}, session field ${JSON.stringify(after.field)}, analysis.v ${after.analysis?.v}`);
})().catch(e => {
  console.error('ERR', e.message);
  process.exit(1);
});
