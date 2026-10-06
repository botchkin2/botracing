import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Refusal, setOwnerKey} from '../scripts/setOwnerKey.mjs';

// docs: path -> data. Queries match top-level collections by field equality.
function fakes({users = ['uidK'], docs = {}} = {}) {
  const store = new Map(Object.entries(docs));
  const writes = [];
  const auth = {
    getUser: async uid => {
      if (!users.includes(uid)) throw new Error('user not found');
      return {uid};
    },
  };
  const query = (collection, field, value) => ({
    limit: () => ({
      get: async () => {
        const hits = [...store]
          .filter(
            ([path, data]) =>
              path.startsWith(`${collection}/`) && data[field] === value,
          )
          .map(([path, data]) => ({id: path.split('/')[1], data: () => data}));
        return {empty: hits.length === 0, docs: hits};
      },
    }),
  });
  const firestore = {
    doc: path => ({
      get: async () => ({
        exists: store.has(path),
        data: () => store.get(path),
      }),
      set: async (data, options) => {
        writes.push({path, data, options});
        store.set(path, {...(options?.merge ? store.get(path) : {}), ...data});
      },
    }),
    collection: name => ({
      where: (field, _op, value) => query(name, field, value),
    }),
  };
  return {auth, firestore, store, writes, log: () => {}};
}

const run = (f, extra = {}) =>
  setOwnerKey({
    auth: f.auth,
    firestore: f.firestore,
    log: f.log,
    uid: 'uidK',
    ownerKey: 'botkin',
    ...extra,
  });

test('maps a new user, keeps the usage counters, and prints before and after', async () => {
  const lines = [];
  const f = fakes({docs: {'users/uidK': {usage: {files: 3}}}});
  f.log = l => lines.push(l);
  const res = await run(f);
  assert.equal(res.changed, true);
  assert.deepEqual(f.store.get('users/uidK'), {
    usage: {files: 3},
    ownerKey: 'botkin',
  });
  assert.deepEqual(f.writes[0].options, {merge: true});
  assert.equal(lines.length, 2);
  assert.match(lines[0], /before: \{"usage":\{"files":3\}\}/);
  assert.match(lines[1], /after:.*"ownerKey":"botkin"/);
});

test('a user with no users doc yet is mapped too', async () => {
  const f = fakes();
  assert.equal((await run(f)).changed, true);
  assert.equal(f.store.get('users/uidK').ownerKey, 'botkin');
});

test('--dry-run writes nothing', async () => {
  const f = fakes();
  const res = await run(f, {dryRun: true});
  assert.equal(res.changed, false);
  assert.equal(f.writes.length, 0);
  assert.equal(f.store.has('users/uidK'), false);
});

test('already mapped to the same key is a no-op', async () => {
  const f = fakes({docs: {'users/uidK': {ownerKey: 'botkin'}}});
  assert.equal((await run(f)).changed, false);
  assert.equal(f.writes.length, 0);
});

test('refuses to overwrite a different key', async () => {
  const f = fakes({docs: {'users/uidK': {ownerKey: 'someone'}}});
  await assert.rejects(
    run(f),
    error =>
      error instanceof Refusal && /refusing to overwrite/.test(error.message),
  );
  assert.equal(f.writes.length, 0);
  assert.equal(f.store.get('users/uidK').ownerKey, 'someone');
});

test('refuses when the user has already uploaded under their uid', async () => {
  const f = fakes({docs: {'sessions/s1': {ownerId: 'uidK'}}});
  await assert.rejects(run(f), /split their data/);
  assert.equal(f.writes.length, 0);
});

test('refuses when another user already holds the key', async () => {
  const f = fakes({docs: {'users/uidOther': {ownerKey: 'botkin'}}});
  await assert.rejects(run(f), /already mapped to user uidOther/);
  assert.equal(f.writes.length, 0);
});

test('refuses an unknown uid and unsafe or missing keys', async () => {
  const f = fakes();
  await assert.rejects(run(f, {uid: 'typo'}), /no Firebase Auth user typo/);
  for (const ownerKey of ['', '../x', 'a/b', '-lead', 'x'.repeat(201)])
    await assert.rejects(run(f, {ownerKey}), Refusal, ownerKey);
  assert.equal(f.writes.length, 0);
});

test('a write that does not stick is reported', async () => {
  const f = fakes();
  const realDoc = f.firestore.doc;
  f.firestore.doc = path => ({...realDoc(path), set: async () => {}});
  await assert.rejects(run(f), /did not stick/);
});
