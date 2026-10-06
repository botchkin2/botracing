import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {gunzipSync, gzipSync} from 'node:zlib';
import {
  MAX_DOC_BYTES,
  MAX_FILE_BYTES,
  MAX_OPS,
  handleUpload,
} from '../src/uploadCore.ts';

// In-memory Firestore and bucket, behind the interfaces uploadApi.ts binds to
// Firebase. users/{uid} holds the owner-key mapping and the usage counters.
function world(tokens = {'tok-a': 'uidA', 'tok-b': 'uidB', 'tok-k': 'uidK'}) {
  const docs = new Map([['users/uidK', {ownerKey: 'botkin'}]]);
  const files = new Map();
  const usage = new Map();
  const deps = {
    verifyToken: async t => {
      if (!tokens[t]) throw new Error('bad');
      return {uid: tokens[t]};
    },
    docs: {
      get: async p => docs.get(p) ?? null,
      lapIds: async (_c, sessionId, ownerKey) =>
        [...docs]
          .filter(
            ([p, d]) =>
              p.startsWith('laps/') &&
              d.sessionId === sessionId &&
              d.ownerId === ownerKey,
          )
          .map(([p]) => p.slice(5)),
      commit: async writes => {
        for (const w of writes) {
          if (w.op === 'delete') docs.delete(w.path);
          else if (w.op === 'update') {
            assert.ok(docs.has(w.path), 'update of a missing doc');
            docs.set(w.path, {...docs.get(w.path), ...w.data});
          } else
            docs.set(
              w.path,
              w.merge ? {...(docs.get(w.path) ?? {}), ...w.data} : w.data,
            );
        }
      },
      addUsage: async (uid, d) => {
        const u = usage.get(uid) ?? {
          docs: 0,
          docBytes: 0,
          files: 0,
          fileBytes: 0,
        };
        for (const k of Object.keys(u)) u[k] += d[k];
        usage.set(uid, u);
      },
    },
    files: {
      stat: async p =>
        files.has(p)
          ? {
              md5Hash: createHash('md5')
                .update(files.get(p).bytes)
                .digest('base64'),
              size: files.get(p).bytes.length,
            }
          : null,
      put: async (p, bytes, meta) => files.set(p, {bytes, meta}),
      read: async p => files.get(p)?.bytes ?? null,
      remove: async p => files.delete(p),
      list: async prefix => [...files.keys()].filter(k => k.startsWith(prefix)),
    },
    gzip: b => gzipSync(b),
  };
  return {deps, docs, files, usage};
}

const call = (w, token, method, path, rest = {}) =>
  handleUpload(w.deps, {
    method,
    path,
    query: {},
    authorization: token ? `Bearer ${token}` : undefined,
    ...rest,
  });
const write = (w, token, ops) =>
  call(w, token, 'POST', '/docs/write', {json: {ops}});
const put = (w, token, dest, body, extra = {}) =>
  call(w, token, 'PUT', '/file', {
    query: {dest, ...extra},
    body: Buffer.from(body),
    contentType: 'text/csv',
  });
const lap = (id, owner, sessionId = 's1') => ({
  op: 'set',
  coll: 'laps',
  id,
  data: {ownerId: owner, sessionId, lapTime: 90.1},
});

test('no token, a bad token and a non-Bearer header are all 401', async () => {
  const w = world();
  assert.equal((await call(w, null, 'GET', '/me')).status, 401);
  assert.equal((await call(w, 'nope', 'GET', '/me')).status, 401);
  const res = await handleUpload(w.deps, {
    method: 'GET',
    path: '/me',
    query: {},
    authorization: 'Basic tok-a',
  });
  assert.equal(res.status, 401);
});

test('the owner key is the uid, or what an admin mapped; a body cannot change it', async () => {
  const w = world();
  assert.deepEqual((await call(w, 'tok-a', 'GET', '/me')).json, {
    ownerKey: 'uidA',
  });
  assert.deepEqual((await call(w, 'tok-k', 'GET', '/me')).json, {
    ownerKey: 'botkin',
  });
  // A request that names an owner is ignored: the doc's ownerId must be mine.
  const res = await write(w, 'tok-a', [lap('l1', 'uidB')]);
  assert.equal(res.status, 403);
  assert.equal(w.docs.has('laps/l1'), false);
});

test('writes land under the owner and only the users collection is off limits', async () => {
  const w = world();
  assert.equal((await write(w, 'tok-a', [lap('l1', 'uidA')])).status, 204);
  assert.equal(w.docs.get('laps/l1').ownerId, 'uidA');
  for (const coll of ['users', 'uploaders', '../users', 'laps/x']) {
    const res = await write(w, 'tok-a', [
      {op: 'set', coll, id: 'uidA', data: {ownerKey: 'botkin'}},
    ]);
    assert.ok(
      res.status === 403 || res.status === 400,
      `${coll}: ${res.status}`,
    );
  }
  assert.equal(w.docs.get('users/uidA'), undefined);
});

test("another owner's document cannot be overwritten, merged into, updated or deleted", async () => {
  const w = world();
  await write(w, 'tok-a', [
    {
      op: 'set',
      coll: 'sessions',
      id: 's1',
      data: {ownerId: 'uidA', series: 'x'},
    },
  ]);
  const mine = JSON.stringify([...w.docs]);
  const evil = [
    {
      op: 'set',
      coll: 'sessions',
      id: 's1',
      data: {ownerId: 'uidB', series: 'y'},
    },
    {
      op: 'set',
      coll: 'sessions',
      id: 's1',
      data: {ownerId: 'uidB'},
      merge: true,
    },
    {op: 'delete', coll: 'sessions', id: 's1'},
  ];
  for (const op of evil)
    assert.equal(
      (await write(w, 'tok-b', [op])).status,
      403,
      JSON.stringify(op),
    );
  const upd = await call(w, 'tok-b', 'POST', '/docs/update', {
    json: {ops: [{coll: 'sessions', id: 's1', data: {series: 'y'}}]},
  });
  assert.equal(upd.status, 403);
  assert.equal(JSON.stringify([...w.docs]), mine);
});

test("reads of another owner's documents are 404, not 403", async () => {
  const w = world();
  await write(w, 'tok-a', [
    {op: 'set', coll: 'sessions', id: 's1', data: {ownerId: 'uidA'}},
    lap('l1', 'uidA'),
  ]);
  assert.equal((await call(w, 'tok-a', 'GET', '/doc/sessions/s1')).status, 200);
  assert.equal((await call(w, 'tok-b', 'GET', '/doc/sessions/s1')).status, 404);
  assert.equal(
    (await call(w, 'tok-b', 'GET', '/doc/sessions/none')).status,
    404,
  );
  const mineIds = await call(w, 'tok-a', 'GET', '/laps', {
    query: {sessionId: 's1'},
  });
  assert.deepEqual(mineIds.json, {ids: ['l1']});
  const theirs = await call(w, 'tok-b', 'GET', '/laps', {
    query: {sessionId: 's1'},
  });
  assert.deepEqual(theirs.json, {ids: []});
  // Not readable at all: laps, recordings, users.
  for (const coll of ['laps', 'recordings', 'users'])
    assert.equal(
      (await call(w, 'tok-a', 'GET', `/doc/${coll}/l1`)).status,
      403,
    );
});

test('track maps are per owner, so one user cannot change what another sees', async () => {
  const w = world();
  const track = v => [{op: 'set', coll: 'tracks', id: 'lmu-road', data: {v}}];
  await write(w, 'tok-k', track(1)); // legacy owner: the shared doc
  await write(w, 'tok-a', track(2));
  await write(w, 'tok-b', track(3));
  assert.equal(w.docs.get('tracks/lmu-road').v, 1);
  assert.equal(w.docs.get('users/uidA/tracks/lmu-road').v, 2);
  assert.equal(w.docs.get('users/uidB/tracks/lmu-road').v, 3);
  assert.equal(
    (await call(w, 'tok-b', 'GET', '/doc/tracks/lmu-road')).json.v,
    3,
  );
});

test('update only merges the event fields into existing docs and reports the rest', async () => {
  const w = world();
  await write(w, 'tok-a', [
    {
      op: 'set',
      coll: 'sessions',
      id: 's1',
      data: {ownerId: 'uidA', series: 'a'},
    },
  ]);
  const res = await call(w, 'tok-a', 'POST', '/docs/update', {
    json: {
      ops: [
        {coll: 'sessions', id: 's1', data: {series: 'b', eventId: 'e'}},
        {coll: 'sessions', id: 'gone', data: {series: 'b'}},
      ],
    },
  });
  assert.deepEqual(res.json, {failed: ['sessions/gone: not found']});
  assert.equal(w.docs.get('sessions/s1').series, 'b');
  assert.equal(w.docs.get('sessions/s1').ownerId, 'uidA');
  const bad = await call(w, 'tok-a', 'POST', '/docs/update', {
    json: {ops: [{coll: 'sessions', id: 's1', data: {ownerId: 'uidB'}}]},
  });
  assert.equal(bad.status, 400);
});

test('documents are checked: plain JSON, size, depth, field names, op count', async () => {
  const w = world();
  const set = data =>
    write(w, 'tok-a', [{op: 'set', coll: 'tracks', id: 't', data}]);
  assert.equal((await set({big: 'x'.repeat(MAX_DOC_BYTES)})).status, 413);
  assert.equal((await set('text')).status, 400);
  assert.equal((await set({'a/b': 1})).status, 400);
  assert.equal((await set({__proto: 1})).status, 400);
  assert.equal((await set({n: null, ok: [1, {a: 'b'}]})).status, 204);
  let deep = {};
  for (let i = 0; i < 30; i++) deep = {d: deep};
  assert.equal((await set(deep)).status, 400);
  const many = Array.from({length: MAX_OPS + 1}, (_, i) =>
    lap(`l${i}`, 'uidA'),
  );
  assert.equal((await write(w, 'tok-a', many)).status, 413);
  // One refused op writes none of the batch.
  const before = w.docs.size;
  const mixed = await write(w, 'tok-a', [lap('ok', 'uidA'), lap('no', 'uidB')]);
  assert.equal(mixed.status, 403);
  assert.equal(w.docs.size, before);
});

test('file paths: allow-listed folders, owner segment must be mine, no traversal', async () => {
  const w = world();
  assert.equal(
    (await put(w, 'tok-a', 'traces/uidA/l1/v2.csv.gz', 'a')).status,
    204,
  );
  assert.ok(w.files.has('traces/uidA/l1/v2.csv.gz'));
  const refused = [
    ['traces/uidB/l1/v2.csv.gz', 403],
    ['traces/uidA/../uidB/l1', 400],
    ['traces//uidA/x', 400],
    ['traces\\uidA\\x', 400],
    ['traces/uidA%2Fx/y', 400],
    ['/traces/uidA/x', 400],
    ['users/uidB/x/y', 403],
    ['surface/lmu/v1.json.gz', 403],
    ['lmu/manifest.json', 400],
    ['traces', 400],
  ];
  for (const [dest, status] of refused)
    assert.equal((await put(w, 'tok-a', dest, 'x')).status, status, dest);
  assert.equal(w.files.size, 1);
});

test('archive files are stored under the owner, except the legacy owner', async () => {
  const w = world();
  await put(w, 'tok-a', 'archive/lmu/s1/r1/samples.parquet', 'p', {});
  await put(w, 'tok-k', 'archive/lmu/s1/r1/samples.parquet', 'k', {});
  assert.ok(w.files.has('archive/uidA/lmu/s1/r1/samples.parquet'));
  assert.ok(w.files.has('archive/lmu/s1/r1/samples.parquet'));
  const list = await call(w, 'tok-a', 'GET', '/files', {
    query: {prefix: 'archive/lmu/s1/'},
  });
  assert.deepEqual(list.json, {names: ['archive/lmu/s1/r1/samples.parquet']});
  const md5 = await call(w, 'tok-b', 'GET', '/file/md5', {
    query: {dest: 'archive/lmu/s1/r1/samples.parquet'},
  });
  assert.deepEqual(md5.json, {md5: null});
});

test('file calls: md5, gzip=1, read, delete, list scoped to the owner', async () => {
  const w = world();
  const dest = 'bands/uidA/s1/v1.json.gz';
  assert.deepEqual(
    (await call(w, 'tok-a', 'GET', '/file/md5', {query: {dest}})).json,
    {md5: null},
  );
  await put(w, 'tok-a', dest, '{"a":1}', {gzip: '1'});
  const stored = w.files.get(dest);
  assert.equal(stored.meta.contentEncoding, 'gzip');
  assert.equal(gunzipSync(stored.bytes).toString(), '{"a":1}');
  const md5 = await call(w, 'tok-a', 'GET', '/file/md5', {query: {dest}});
  assert.equal(
    md5.json.md5,
    createHash('md5').update(stored.bytes).digest('base64'),
  );
  const read = await call(w, 'tok-a', 'GET', '/file', {query: {dest}});
  assert.deepEqual(Buffer.from(read.bytes), Buffer.from(stored.bytes));
  assert.equal(
    (await call(w, 'tok-b', 'GET', '/file', {query: {dest}})).status,
    403,
  );
  assert.deepEqual(
    (
      await call(w, 'tok-a', 'GET', '/files', {
        query: {prefix: 'bands/uidA/s1/'},
      })
    ).json,
    {names: [dest]},
  );
  assert.equal(
    (await call(w, 'tok-b', 'GET', '/files', {query: {prefix: 'bands/uidA/'}}))
      .status,
    403,
  );
  assert.equal(
    (await call(w, 'tok-a', 'DELETE', '/file', {query: {dest}})).status,
    204,
  );
  assert.equal(
    (await call(w, 'tok-a', 'DELETE', '/file', {query: {dest}})).status,
    404,
  );
  assert.equal(
    (await call(w, 'tok-a', 'GET', '/file', {query: {dest}})).status,
    404,
  );
});

test('a file over the size cap is refused and not stored', async () => {
  const w = world();
  const res = await put(
    w,
    'tok-a',
    'traces/uidA/l1/big',
    Buffer.alloc(MAX_FILE_BYTES + 1),
  );
  assert.equal(res.status, 413);
  assert.equal(w.files.size, 0);
  assert.equal(w.usage.has('uidA'), false);
});

test('usage counts what was written: new, overwritten and deleted', async () => {
  const w = world();
  await put(w, 'tok-a', 'traces/uidA/l1/a', '12345');
  await put(w, 'tok-a', 'traces/uidA/l1/a', '123');
  await put(w, 'tok-a', 'traces/uidA/l1/b', '12');
  assert.deepEqual(
    {files: w.usage.get('uidA').files, bytes: w.usage.get('uidA').fileBytes},
    {files: 2, bytes: 5},
  );
  await call(w, 'tok-a', 'DELETE', '/file', {
    query: {dest: 'traces/uidA/l1/a'},
  });
  assert.deepEqual(
    {files: w.usage.get('uidA').files, bytes: w.usage.get('uidA').fileBytes},
    {files: 1, bytes: 2},
  );

  await write(w, 'tok-a', [lap('l1', 'uidA'), lap('l2', 'uidA')]);
  assert.equal(w.usage.get('uidA').docs, 2);
  const size1 = w.usage.get('uidA').docBytes;
  await write(w, 'tok-a', [lap('l1', 'uidA')]); // rewrite, same size
  assert.equal(w.usage.get('uidA').docs, 2);
  assert.equal(w.usage.get('uidA').docBytes, size1);
  await write(w, 'tok-a', [{op: 'delete', coll: 'laps', id: 'l2'}]);
  assert.equal(w.usage.get('uidA').docs, 1);
  assert.equal(w.usage.has('uidB'), false);
});

test('unknown endpoints and methods are 404', async () => {
  const w = world();
  assert.equal((await call(w, 'tok-a', 'POST', '/me')).status, 404);
  assert.equal((await call(w, 'tok-a', 'GET', '/docs/write')).status, 404);
  assert.equal((await call(w, 'tok-a', 'GET', '/nope')).status, 404);
});
