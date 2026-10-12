import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {
  BATCH,
  applyDelete,
  describePlan,
  hashOf,
  planDelete,
  sessionPrefixes,
  writeRecord,
} from './deleteSessions.mjs';

const OWNER = 'owner-a';
const OLD = 'aaaaaaaaaaaaaaaa';
const NEXT = 'aaaaaaaaaaaaaaab'; // shares the first 15 characters with OLD
const NEW = 'bbbbbbbbbbbbbbbb';

// An in-memory store with the backend's calls, and a log of what was deleted.
function fakeStore(docs = {}, files = {}) {
  const store = {
    docs: structuredClone(docs),
    files: structuredClone(files),
    deletedDocs: [],
    deletedFiles: [],
    batches: [],
    failOn: null,
  };
  return Object.assign(store, {
    async getDoc(path) {
      return store.docs[path] ?? null;
    },
    async listBySession(coll, sessionId, ownerId) {
      return Object.entries(store.docs)
        .filter(([p, d]) => p.startsWith(`${coll}/`) && d.sessionId === sessionId && d.ownerId === ownerId)
        .map(([p, data]) => ({id: p.slice(coll.length + 1), data}));
    },
    async listFiles(prefix) {
      return Object.entries(store.files)
        .filter(([p]) => p.startsWith(prefix))
        .map(([path, size]) => ({path, size}));
    },
    async deleteDocs(paths) {
      store.batches.push(paths.length);
      for (const p of paths) {
        delete store.docs[p];
        store.deletedDocs.push(p);
      }
    },
    async deleteFile(path) {
      if (store.failOn === path) throw new Error('boom');
      delete store.files[path];
      store.deletedFiles.push(path);
    },
  });
}

const session = (id, owner = OWNER) => ({
  [`sessions/${id}`]: {ownerId: owner, sim: 'iracing', track: {name: 'Fuji'}, sessionType: 'Practice', startedAt: '2026-10-04'},
});
const lap = (id, sessionId, owner = OWNER) => ({[`laps/${id}`]: {sessionId, ownerId: owner}});
const recording = (id, sessionId, owner = OWNER) => ({[`recordings/${id}`]: {sessionId, ownerId: owner}});

function world() {
  return fakeStore(
    {
      ...session(OLD),
      ...session(NEXT),
      ...session(NEW),
      ...lap('lap-1', OLD),
      ...lap('lap-2', NEXT),
      ...lap('lap-3', NEW),
      ...lap('lap-other-owner', OLD, 'owner-b'),
    },
    {
      [`bands/${OWNER}/${OLD}/v1.json.gz`]: 10,
      [`slices/${OWNER}/${OLD}/h/c1.json.gz`]: 20,
      [`field/${OWNER}/${OLD}/h.json.gz`]: 30,
      [`traces/${OWNER}/lap-1/v2.csv.gz`]: 40,
      // A neighbour: same first 15 characters, and another owner's, and the new set.
      [`bands/${OWNER}/${NEXT}/v1.json.gz`]: 11,
      [`bands/owner-b/${OLD}/v1.json.gz`]: 12,
      [`bands/${OWNER}/${NEW}/v1.json.gz`]: 13,
      [`traces/${OWNER}/lap-3/v2.csv.gz`]: 41,
      [`archive/iracing/${OLD}/r/samples.parquet`]: 500,
    },
  );
}

test('the plan names the session, its laps and its objects, and nothing of a neighbour', async () => {
  const plan = await planDelete(world(), {owner: OWNER, ids: [OLD]});
  assert.deepEqual(plan.refusals, []);
  const [s] = plan.sessions;
  assert.equal(s.doc, `sessions/${OLD}`);
  assert.deepEqual(s.laps, ['lap-1']);
  assert.deepEqual(
    s.files.map(f => f.path),
    [
      `bands/${OWNER}/${OLD}/v1.json.gz`,
      `field/${OWNER}/${OLD}/h.json.gz`,
      `slices/${OWNER}/${OLD}/h/c1.json.gz`,
      `traces/${OWNER}/lap-1/v2.csv.gz`,
    ],
  );
  // The archive is only with --archive.
  const withArchive = await planDelete(world(), {owner: OWNER, ids: [OLD], archive: true});
  assert.ok(withArchive.sessions[0].files.some(f => f.path.startsWith('archive/iracing/')));
});

test('prefixes end in a slash: abc never reaches abcd', () => {
  for (const p of sessionPrefixes({owner: OWNER, id: OLD, sim: 'iracing', archive: true}))
    assert.ok(p.endsWith('/'), p);
});

test('a session of another owner is refused', async () => {
  const store = fakeStore({...session(OLD, 'owner-b')});
  const plan = await planDelete(store, {owner: OWNER, ids: [OLD]});
  assert.equal(plan.sessions.length, 0);
  assert.match(plan.refusals[0].why, /belongs to owner-b/);
});

test('a missing document with leftovers is refused; with nothing left it is a no-op', async () => {
  const leftovers = fakeStore({...lap('lap-1', OLD)}, {[`bands/${OWNER}/${OLD}/v1.json.gz`]: 1});
  const refused = await planDelete(leftovers, {owner: OWNER, ids: [OLD]});
  assert.match(refused.refusals[0].why, /no session document, but 1 lap\(s\) and 1 object\(s\) remain/);
  const gone = await planDelete(fakeStore(), {owner: OWNER, ids: [OLD]});
  assert.deepEqual(gone.refusals, []);
  assert.deepEqual(gone.sessions[0].files, []);
  assert.equal(gone.sessions[0].doc, null);
  const record = await applyDelete(fakeStore(), gone, {confirm: gone.hash});
  assert.deepEqual(record.docs, []);
});

test('an id the current grouping produces is refused', async () => {
  const plan = await planDelete(world(), {owner: OWNER, ids: [NEW, OLD], currentIds: new Set([NEW])});
  assert.match(plan.refusals[0].why, /current session/);
  await assert.rejects(applyDelete(world(), plan, {confirm: plan.hash}), /refused/);
});

test('a session a recording still points at is refused, and the count is printed', async () => {
  const store = fakeStore({...session(OLD), ...lap('lap-1', OLD), ...recording('r1', OLD)});
  const plan = await planDelete(store, {owner: OWNER, ids: [OLD]});
  assert.match(plan.refusals[0].why, /1 recording\(s\) still point/);
  await assert.rejects(applyDelete(store, plan, {confirm: plan.hash}), /refused/);
  // Another owner's recording, or one re-pointed to the new id, does not count.
  const moved = fakeStore({...session(OLD), ...recording('r1', NEW), ...recording('r2', OLD, 'owner-b')});
  const ok = await planDelete(moved, {owner: OWNER, ids: [OLD]});
  assert.deepEqual(ok.refusals, []);
  assert.equal(ok.sessions[0].recordings, 0);
  assert.ok(describePlan(ok).some(l => l.includes('recordings pointing here: 0')));
});

test('--archive lists both layouts: the Admin sync and the tray upload (ownerKey)', async () => {
  const KEY = 'key-of-owner';
  const store = fakeStore(
    {...session(OLD), 'users/owner-a': {ownerKey: KEY}},
    {
      [`archive/iracing/${OLD}/r/samples.parquet`]: 5,
      [`archive/${KEY}/iracing/${OLD}/r/samples.parquet`]: 6,
      [`archive/${KEY}/iracing/${NEXT}/r/samples.parquet`]: 7,
    },
  );
  const plan = await planDelete(store, {owner: OWNER, ids: [OLD], archive: true});
  assert.deepEqual(
    plan.sessions[0].files.map(f => f.path),
    [`archive/iracing/${OLD}/r/samples.parquet`, `archive/${KEY}/iracing/${OLD}/r/samples.parquet`],
  );
  for (const p of sessionPrefixes({owner: OWNER, id: OLD, sim: 'iracing', archive: true, ownerKey: KEY}))
    assert.ok(p.endsWith('/'), p);
  // Without a users doc the key is the uid.
  const plain = await planDelete(fakeStore({...session(OLD)}, {[`archive/${OWNER}/iracing/${OLD}/r/s.parquet`]: 1}), {owner: OWNER, ids: [OLD], archive: true});
  assert.equal(plain.sessions[0].files.length, 1);
});

test('a throwing document batch still returns a record of what went and what failed', async () => {
  const laps = Object.fromEntries(
    Array.from({length: 1200}, (_, i) => [`laps/l${i}`, {sessionId: OLD, ownerId: OWNER}]),
  );
  const store = fakeStore({...session(OLD), ...laps});
  const real = store.deleteDocs;
  let calls = 0;
  store.deleteDocs = async paths => {
    if (++calls === 2) throw new Error('quota');
    return real(paths);
  };
  const plan = await planDelete(store, {owner: OWNER, ids: [OLD]});
  const record = await applyDelete(store, plan, {confirm: plan.hash});
  assert.equal(record.docs.length, BATCH);
  assert.equal(record.failed.length, 1);
  assert.match(record.failed[0].error, /quota/);
  assert.ok(store.docs[`sessions/${OLD}`], 'the session document stays as the handle');
});

test('a lap of the same session under another owner is never listed', async () => {
  const plan = await planDelete(world(), {owner: OWNER, ids: [OLD]});
  assert.ok(!plan.sessions[0].laps.includes('lap-other-owner'));
});

test('apply needs the hash of the set as it is now', async () => {
  const store = world();
  const plan = await planDelete(store, {owner: OWNER, ids: [OLD]});
  await assert.rejects(applyDelete(store, plan, {}), /not the one given/);
  await assert.rejects(applyDelete(store, plan, {confirm: '0000000000000000'}), /run the dry run again/);
  assert.deepEqual(store.deletedDocs, []);
  assert.deepEqual(store.deletedFiles, []);
  // The set changes after the dry run (a new object appears): the old hash no longer fits.
  store.files[`bands/${OWNER}/${OLD}/v2.json.gz`] = 5;
  const again = await planDelete(store, {owner: OWNER, ids: [OLD]});
  assert.notEqual(again.hash, plan.hash);
});

test('apply deletes exactly the set: objects, then laps, then the session, and leaves the rest', async () => {
  const store = world();
  const plan = await planDelete(store, {owner: OWNER, ids: [OLD]});
  const record = await applyDelete(store, plan, {confirm: plan.hash, now: () => new Date('2026-10-11T10:00:00Z')});
  assert.equal(record.hash, plan.hash);
  assert.deepEqual(record.failed, []);
  assert.deepEqual(store.deletedDocs, ['laps/lap-1', `sessions/${OLD}`]);
  assert.equal(store.deletedFiles.length, 4);
  // The neighbours, the other owner's and the new set are all still there.
  for (const kept of [`sessions/${NEXT}`, `sessions/${NEW}`, 'laps/lap-2', 'laps/lap-3', 'laps/lap-other-owner'])
    assert.ok(store.docs[kept], kept);
  for (const kept of [`bands/${OWNER}/${NEXT}/v1.json.gz`, `bands/owner-b/${OLD}/v1.json.gz`, `bands/${OWNER}/${NEW}/v1.json.gz`, `traces/${OWNER}/lap-3/v2.csv.gz`, `archive/iracing/${OLD}/r/samples.parquet`])
    assert.ok(store.files[kept] != null, kept);
});

test('a second run of the same list is a no-op', async () => {
  const store = world();
  const first = await planDelete(store, {owner: OWNER, ids: [OLD]});
  await applyDelete(store, first, {confirm: first.hash});
  const deleted = store.deletedDocs.length + store.deletedFiles.length;
  const second = await planDelete(store, {owner: OWNER, ids: [OLD]});
  assert.deepEqual(second.refusals, []);
  const record = await applyDelete(store, second, {confirm: second.hash});
  assert.deepEqual([...record.docs, ...record.files], []);
  assert.equal(store.deletedDocs.length + store.deletedFiles.length, deleted);
});

test('a failed object stops before any document goes, and the session document stays as the handle', async () => {
  const store = world();
  store.failOn = `field/${OWNER}/${OLD}/h.json.gz`;
  const plan = await planDelete(store, {owner: OWNER, ids: [OLD]});
  const record = await applyDelete(store, plan, {confirm: plan.hash});
  assert.equal(record.failed.length, 1);
  assert.deepEqual(store.deletedDocs, []);
  assert.ok(store.docs[`sessions/${OLD}`]);
  // After the cause is fixed, the same command finishes it.
  store.failOn = null;
  const again = await planDelete(store, {owner: OWNER, ids: [OLD]});
  await applyDelete(store, again, {confirm: again.hash});
  assert.equal(store.docs[`sessions/${OLD}`], undefined);
});

test('documents go in batches of at most 500', async () => {
  const laps = Object.fromEntries(
    Array.from({length: 1200}, (_, i) => [`laps/l${i}`, {sessionId: OLD, ownerId: OWNER}]),
  );
  const store = fakeStore({...session(OLD), ...laps});
  const plan = await planDelete(store, {owner: OWNER, ids: [OLD]});
  await applyDelete(store, plan, {confirm: plan.hash});
  assert.deepEqual(store.batches, [BATCH, BATCH, 200, 1]);
});

test('a malformed id is refused', async () => {
  const plan = await planDelete(world(), {owner: OWNER, ids: ['../x', 'abc']});
  assert.equal(plan.refusals.length, 2);
});

test('the dry run prints the set and its hash; the record lands beside the run', async () => {
  const plan = await planDelete(world(), {owner: OWNER, ids: [OLD]});
  const lines = describePlan(plan);
  assert.ok(lines.some(l => l.includes(OLD)));
  assert.ok(lines.at(-1).includes(plan.hash));
  assert.equal(hashOf(plan), plan.hash);
  const dir = mkdtempSync(join(tmpdir(), 'del-'));
  try {
    const record = await applyDelete(world(), plan, {confirm: plan.hash, now: () => new Date('2026-10-11T10:00:00Z')});
    const path = writeRecord(dir, record);
    const written = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(written.owner, OWNER);
    assert.equal(written.docs.length, 2);
    assert.equal(written.files.length, 4);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
