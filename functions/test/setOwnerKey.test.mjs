import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Refusal, parseArgs, setOwnerKey} from '../scripts/setOwnerKey.mjs';

// docs: path -> data. Queries match top-level collections by field equality.
function fakes({users = ['uidK'], docs = {}, files = []} = {}) {
  const store = new Map(Object.entries(docs));
  const writes = [];
  const auth = {
    getUser: async uid => {
      if (!users.includes(uid)) throw new Error('user not found');
      return {uid};
    },
  };
  const matching = (collection, field, value) =>
    [...store]
      .filter(
        ([path, data]) =>
          path.startsWith(collection + '/') && data[field] === value,
      )
      .map(([path, data]) => ({id: path.split('/')[1], data: () => data}));
  const query = (collection, field, value) => ({
    limit: () => ({
      get: async () => {
        const hits = matching(collection, field, value);
        return {empty: hits.length === 0, docs: hits};
      },
    }),
    count: () => ({
      get: async () => ({
        data: () => ({count: matching(collection, field, value).length}),
      }),
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
  const hasFiles = async prefix => files.some(name => name.startsWith(prefix));
  return {auth, firestore, hasFiles, store, writes, log: () => {}};
}

const run = (f, extra = {}) =>
  setOwnerKey({
    auth: f.auth,
    firestore: f.firestore,
    hasFiles: f.hasFiles,
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

test('a lap or recording with no session (an interrupted first upload) is a split too', async () => {
  for (const doc of ['laps/l1', 'recordings/r1']) {
    const f = fakes({docs: {[doc]: {ownerId: 'uidK'}}});
    await assert.rejects(run(f), /already exist with ownerId == uidK/, doc);
    assert.equal(f.writes.length, 0);
  }
});

test('files left under the uid (no session, no docs) are a split too', async () => {
  for (const name of [
    'traces/uidK/l1/v2.csv.gz',
    'bands/uidK/s1/v1.json.gz',
    'slices/uidK/s1/h/c1.json.gz',
    'field/uidK/s1/h.json.gz',
    'archive/uidK/lmu/s1/r1/samples.parquet',
  ]) {
    const f = fakes({files: [name]});
    await assert.rejects(run(f), /files already exist under/, name);
    assert.equal(f.writes.length, 0);
  }
  // Another user's files do not count.
  const f = fakes({files: ['traces/uidOther/l1/v2.csv.gz']});
  assert.equal((await run(f)).changed, true);
});

test("refuses a key that is another Firebase user's uid", async () => {
  const f = fakes({users: ['uidK', 'uidOther']});
  await assert.rejects(
    run(f, {ownerKey: 'uidOther'}),
    /uid of another Firebase user/,
  );
  assert.equal(f.writes.length, 0);
  // Mapping a user to their own uid is allowed (it just pins the default).
  assert.equal((await run(fakes(), {ownerKey: 'uidK'})).changed, true);
});

// -- --replace: the switch after an owner copy, and its rollback -----------------

const replaceRun = (f, extra = {}) =>
  run(f, {ownerKey: 'uidK', replace: 'botkin', ...extra});
const copied = {'sessions/s1': {ownerId: 'uidK'}};

test('replace switches a mapped user to the new key once the key holds data, and keeps the rest of the doc', async () => {
  const f = fakes({
    docs: {'users/uidK': {ownerKey: 'botkin', usage: {files: 3}}, ...copied},
  });
  const res = await replaceRun(f);
  assert.equal(res.changed, true);
  assert.deepEqual(f.store.get('users/uidK'), {
    ownerKey: 'uidK',
    usage: {files: 3},
  });
  assert.deepEqual(f.writes[0].options, {merge: true});
});

test('replace --dry-run says what it would do and writes nothing', async () => {
  const lines = [];
  const f = fakes({docs: {'users/uidK': {ownerKey: 'botkin'}, ...copied}});
  f.log = l => lines.push(l);
  const res = await replaceRun(f, {dryRun: true});
  assert.equal(res.changed, false);
  assert.equal(f.writes.length, 0);
  assert.ok(
    lines.some(l =>
      l.includes("would replace users/uidK.ownerKey 'botkin' with 'uidK'"),
    ),
  );
});

test('replace refuses when the current key is not the one the runbook expected', async () => {
  const f = fakes({docs: {'users/uidK': {ownerKey: 'botkin'}, ...copied}});
  await assert.rejects(
    replaceRun(f, {replace: 'someone'}),
    err =>
      err instanceof Refusal &&
      /current owner key is 'botkin', not the expected 'someone'/.test(
        err.message,
      ),
  );
  assert.equal(f.writes.length, 0);
});

test('replace will not switch a user onto a key that holds no data', async () => {
  const f = fakes({docs: {'users/uidK': {ownerKey: 'botkin'}}});
  await assert.rejects(
    replaceRun(f),
    err =>
      err instanceof Refusal &&
      /no session has ownerId == 'uidK'/.test(err.message),
  );
  assert.equal(f.writes.length, 0);
});

test('replace with the key the user already has does nothing and says so', async () => {
  const f = fakes({docs: {'users/uidK': {ownerKey: 'uidK'}, ...copied}});
  await assert.rejects(
    replaceRun(f, {replace: 'uidK'}),
    err => err instanceof Refusal && /already 'uidK'/.test(err.message),
  );
});

test("replace refuses another user's uid and a key another user is mapped to", async () => {
  const other = fakes({
    users: ['uidK', 'uidO'],
    docs: {
      'users/uidK': {ownerKey: 'botkin'},
      'sessions/s9': {ownerId: 'uidO'},
    },
  });
  await assert.rejects(
    replaceRun(other, {ownerKey: 'uidO'}),
    err =>
      err instanceof Refusal &&
      /uid of another Firebase user/.test(err.message),
  );
  const mapped = fakes({
    docs: {
      'users/uidK': {ownerKey: 'botkin'},
      'users/uidZ': {ownerKey: 'team'},
      'sessions/s7': {ownerId: 'team'},
    },
  });
  await assert.rejects(
    replaceRun(mapped, {ownerKey: 'team'}),
    err =>
      err instanceof Refusal && /already mapped to user uidZ/.test(err.message),
  );
});

test('the rollback is the same command the other way: an unmapped user is expected to have their uid as key', async () => {
  const f = fakes({docs: {'sessions/old': {ownerId: 'botkin'}}});
  const res = await run(f, {ownerKey: 'botkin', replace: 'uidK'});
  assert.equal(res.changed, true);
  assert.equal(f.store.get('users/uidK').ownerKey, 'botkin');
  // And it names what it expects: a runbook that thinks the user is on 'botkin' is refused.
  const g = fakes({
    docs: {
      'users/uidK': {ownerKey: 'uidK'},
      'sessions/old': {ownerId: 'botkin'},
    },
  });
  await assert.rejects(
    run(g, {ownerKey: 'botkin', replace: 'botkin'}),
    err => err instanceof Refusal,
  );
});

test('without --replace an existing mapping is still never overwritten', async () => {
  const f = fakes({docs: {'users/uidK': {ownerKey: 'botkin'}}});
  await assert.rejects(
    run(f, {ownerKey: 'uidK'}),
    err => err instanceof Refusal && /refusing to overwrite/.test(err.message),
  );
});

// -- the command line: the plain form must keep working (it once dropped the uid) --

test('the plain two-argument form parses, with and without --dry-run', () => {
  assert.deepEqual(parseArgs(['uidX', 'botkin']), {
    uid: 'uidX',
    ownerKey: 'botkin',
    replace: undefined,
    allowFewer: false,
    dryRun: false,
  });
  const dry = parseArgs(['uidX', 'botkin', '--dry-run']);
  assert.equal(dry.uid, 'uidX');
  assert.equal(dry.ownerKey, 'botkin');
  assert.equal(dry.dryRun, true);
  // Flags first or between, too.
  assert.equal(parseArgs(['--dry-run', 'uidX', 'botkin']).uid, 'uidX');
});

test('the replace form parses and its value is not taken for an argument', () => {
  const p = parseArgs(['uidX', 'uidX', '--replace', 'botkin', '--dry-run']);
  assert.deepEqual(
    [p.uid, p.ownerKey, p.replace, p.dryRun, p.allowFewer],
    ['uidX', 'uidX', 'botkin', true, false],
  );
  const q = parseArgs(['--replace', 'botkin', 'uidX', 'uidX', '--allow-fewer']);
  assert.deepEqual(
    [q.uid, q.ownerKey, q.replace, q.allowFewer],
    ['uidX', 'uidX', 'botkin', true],
  );
});

test('bad command lines are errors, not guesses', () => {
  for (const args of [
    [],
    ['uidX'],
    ['uidX', 'a', 'b'],
    ['uidX', 'botkin', '--replace'],
    ['uidX', 'botkin', '--replace', '--dry-run'],
    ['uidX', 'botkin', '--bogus'],
    ['uidX', 'botkin', '--allow-fewer'],
  ]) {
    assert.ok(parseArgs(args).error, JSON.stringify(args));
  }
});

// -- the switch compares counts ----------------------------------------------------

const sessionsOf = (key, n) =>
  Object.fromEntries(
    Array.from({length: n}, (_, i) => [
      'sessions/' + key + '-s' + i,
      {ownerId: key},
    ]),
  );

test('the switch is refused when the new key holds fewer sessions than the key being left', async () => {
  const lines = [];
  const f = fakes({
    docs: {
      'users/uidK': {ownerKey: 'botkin'},
      ...sessionsOf('botkin', 3),
      ...sessionsOf('uidK', 2),
    },
  });
  f.log = l => lines.push(l);
  await assert.rejects(
    replaceRun(f),
    err =>
      err instanceof Refusal &&
      /holds 2 sessions, fewer than the 3 under 'botkin': 1 would no longer be shown/.test(
        err.message,
      ) &&
      /--allow-fewer/.test(err.message),
  );
  assert.equal(f.writes.length, 0);
  assert.ok(
    lines.some(l =>
      l.includes("3 under 'botkin' (the key being left), 2 under 'uidK'"),
    ),
  );
});

test('as many sessions as the key being left is enough, and the dry run shows both counts', async () => {
  const lines = [];
  const f = fakes({
    docs: {
      'users/uidK': {ownerKey: 'botkin'},
      ...sessionsOf('botkin', 3),
      ...sessionsOf('uidK', 3),
    },
  });
  f.log = l => lines.push(l);
  const dry = await replaceRun(f, {dryRun: true});
  assert.equal(dry.changed, false);
  assert.ok(
    lines.some(l =>
      l.includes("3 under 'botkin' (the key being left), 3 under 'uidK'"),
    ),
  );
  assert.equal((await replaceRun(f)).changed, true);
});

test('--allow-fewer lets a deliberate partial switch through, and says how many sessions it hides', async () => {
  const lines = [];
  const f = fakes({
    docs: {
      'users/uidK': {ownerKey: 'botkin'},
      ...sessionsOf('botkin', 5),
      ...sessionsOf('uidK', 2),
    },
  });
  f.log = l => lines.push(l);
  const res = await replaceRun(f, {allowFewer: true});
  assert.equal(res.changed, true);
  assert.ok(
    lines.some(
      l =>
        l.includes('--allow-fewer: 3 more sessions under') &&
        l.includes('no longer be shown'),
    ),
  );
});

test('a rollback after new uploads under the uid is refused without --allow-fewer: it would hide them', async () => {
  // The user has been on 'uidK' for a while: 5 sessions there, 3 old ones under 'botkin'.
  const docs = {
    'users/uidK': {ownerKey: 'uidK'},
    ...sessionsOf('botkin', 3),
    ...sessionsOf('uidK', 5),
  };
  const refused = fakes({docs});
  await assert.rejects(
    run(refused, {ownerKey: 'botkin', replace: 'uidK'}),
    err =>
      err instanceof Refusal &&
      /holds 3 sessions, fewer than the 5 under 'uidK': 2 would no longer be shown/.test(
        err.message,
      ),
  );
  const lines = [];
  const allowed = fakes({docs});
  allowed.log = l => lines.push(l);
  const res = await run(allowed, {
    ownerKey: 'botkin',
    replace: 'uidK',
    allowFewer: true,
  });
  assert.equal(res.changed, true);
  assert.ok(lines.some(l => l.includes('2 more sessions under')));
  // Before any new upload, a rollback is clean: the counts are equal.
  const clean = fakes({
    docs: {
      'users/uidK': {ownerKey: 'uidK'},
      ...sessionsOf('botkin', 3),
      ...sessionsOf('uidK', 3),
    },
  });
  assert.equal(
    (await run(clean, {ownerKey: 'botkin', replace: 'uidK'})).changed,
    true,
  );
});
