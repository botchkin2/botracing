import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {gunzipSync, gzipSync} from 'node:zlib';
import {httpBackend} from '../../tools/sessions/storeClient.mjs';
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
  const signed = new Map();
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
          heartbeats: 0,
        };
        for (const k of Object.keys(u)) u[k] += d[k] ?? 0;
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
      // What Storage would do with the signed URL; the test's put() below plays
      // the client's PUT against it.
      signedUpload: async (p, opts) => {
        signed.set(`fake://${p}`, {path: p, ...opts});
        return {
          url: `fake://${p}`,
          headers: {
            'Content-Type': opts.contentType,
            'x-goog-content-length-range': `0,${opts.maxBytes}`,
          },
        };
      },
      read: async p => files.get(p)?.bytes ?? null,
      remove: async p => files.delete(p),
      list: async prefix => [...files.keys()].filter(k => k.startsWith(prefix)),
    },
  };
  return {deps, docs, files, usage, signed};
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
// The client's two steps: ask for a signed URL (the client gzips first and
// sends the final size), then PUT the bytes to it.
const put = async (w, token, dest, text, {gzip = false} = {}) => {
  const bytes = gzip ? gzipSync(Buffer.from(text)) : Buffer.from(text);
  const res = await call(w, token, 'POST', '/file/upload-url', {
    json: {dest, contentType: 'text/csv', gzip, size: bytes.length},
  });
  if (res.status !== 200) return res;
  const grant = w.signed.get(res.json.url);
  assert.ok(bytes.length <= grant.maxBytes, 'Storage would refuse this body');
  w.files.set(grant.path, {bytes, meta: grant});
  return {status: 204};
};
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

test('file calls: md5, signed upload with gzip, read, delete, list scoped to the owner', async () => {
  const w = world();
  const dest = 'bands/uidA/s1/v1.json.gz';
  assert.deepEqual(
    (await call(w, 'tok-a', 'GET', '/file/md5', {query: {dest}})).json,
    {md5: null},
  );
  await put(w, 'tok-a', dest, '{"a":1}', {gzip: true});
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
  const ask = size =>
    call(w, 'tok-a', 'POST', '/file/upload-url', {
      json: {dest: 'traces/uidA/l1/big', contentType: 'text/csv', size},
    });
  assert.equal((await ask(MAX_FILE_BYTES + 1)).status, 413);
  for (const size of [-1, 1.5, '9', null])
    assert.equal((await ask(size)).status, 400, String(size));
  const res = await call(w, 'tok-a', 'POST', '/file/upload-url', {
    json: {dest: 'traces/uidA/l1/big', contentType: 'text/html; x', size: 1},
  });
  assert.equal(res.status, 400);
  assert.equal(w.signed.size, 0);
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

test("the legacy owner's archive path cannot reach another owner's archive folder", async () => {
  const w = world();
  for (const dest of [
    'archive/uidA/lmu/s1/r1/samples.parquet',
    'archive/other/s1/r1/samples.parquet',
  ]) {
    assert.equal((await put(w, 'tok-k', dest, 'x')).status, 403, dest);
    assert.equal(
      (await call(w, 'tok-k', 'GET', '/file', {query: {dest}})).status,
      403,
    );
  }
  assert.equal(
    (
      await call(w, 'tok-k', 'GET', '/files', {
        query: {prefix: 'archive/uidA/'},
      })
    ).status,
    403,
  );
  assert.equal(w.signed.size, 0);
});

test('a signed upload is for the server-built path, with the size bound and encoding', async () => {
  const w = world();
  const res = await call(w, 'tok-a', 'POST', '/file/upload-url', {
    json: {
      dest: 'archive/lmu/s1/r1/samples.parquet',
      contentType: 'application/vnd.apache.parquet',
      gzip: false,
      size: 1234,
    },
  });
  assert.equal(res.status, 200);
  const grant = w.signed.get(res.json.url);
  assert.equal(grant.path, 'archive/uidA/lmu/s1/r1/samples.parquet');
  assert.equal(grant.maxBytes, 1234);
  assert.equal(grant.contentEncoding, undefined);
  assert.equal(res.json.headers['x-goog-content-length-range'], '0,1234');
  const gz = await call(w, 'tok-a', 'POST', '/file/upload-url', {
    json: {
      dest: 'bands/uidA/s1/v1.json.gz',
      contentType: 'application/json',
      gzip: true,
      size: 9,
    },
  });
  assert.equal(w.signed.get(gz.json.url).contentEncoding, 'gzip');
});

test('a document is limited by its bytes, not its characters', async () => {
  const w = world();
  // 400,000 three-byte characters: 400k chars but over 1.2 MB.
  const res = await write(w, 'tok-a', [
    {op: 'set', coll: 'tracks', id: 't', data: {name: '€'.repeat(400_000)}},
  ]);
  assert.equal(res.status, 413);
});

// The real client (tools/sessions/storeClient.mjs) against the real handler,
// with fetch wired in-process: what #275 sends is what #274 accepts.
function clientFor(w, tokenName) {
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.protocol === 'fake:') {
      // The signed URL: Storage takes the PUT.
      const grant = w.signed.get(
        `fake://${decodeURIComponent(u.hostname + u.pathname)}`,
      );
      assert.ok(grant, 'PUT to a URL the server did not sign');
      assert.ok(init.body.length <= grant.maxBytes);
      w.files.set(grant.path, {bytes: Buffer.from(init.body), meta: grant});
      return new Response(null, {status: 200});
    }
    const headers = Object.fromEntries(
      Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const out = await handleUpload(w.deps, {
      method: init.method ?? 'GET',
      path: u.pathname.replace('/api/upload', ''),
      query: Object.fromEntries(u.searchParams),
      authorization: headers.authorization,
      json: init.body ? JSON.parse(init.body) : undefined,
    });
    if (out.bytes) return new Response(out.bytes, {status: 200});
    if (out.json === undefined) return new Response(null, {status: out.status});
    return Response.json(out.json, {status: out.status});
  };
  return httpBackend({
    api: 'https://x.test/api/upload',
    token: () => tokenName,
    fetch,
  });
}

test('the real client works against the handler: docs, files, laps, events', async () => {
  const w = world();
  const a = clientFor(w, 'tok-a');
  assert.deepEqual(await a.me(), {ownerKey: 'uidA'});
  await a.writeDocs([
    {
      op: 'set',
      coll: 'laps',
      id: 'l1',
      data: {ownerId: 'uidA', sessionId: 's1'},
    },
    {op: 'set', coll: 'recordings', id: 'r1', data: {ownerId: 'uidA'}},
    {
      op: 'set',
      coll: 'sessions',
      id: 's1',
      data: {ownerId: 'uidA', series: 'x'},
    },
    {op: 'set', coll: 'tracks', id: 't1', data: {v: 1}, merge: true},
  ]);
  assert.deepEqual(await a.sessionLapIds('s1'), ['l1']);
  assert.equal((await a.getDoc('sessions', 's1')).series, 'x');
  assert.equal(await a.getDoc('sessions', 'nope'), null);
  assert.deepEqual(
    await a.updateDocs([{coll: 'sessions', id: 's1', data: {series: 'y'}}]),
    [],
  );
  assert.equal(w.docs.get('sessions/s1').series, 'y');

  const dest = 'archive/lmu/s1/r1/samples.parquet';
  assert.equal(await a.fileMd5(dest), null);
  await a.putFile(
    dest,
    {body: Buffer.from('parquet-bytes')},
    {contentType: 'application/vnd.apache.parquet', gzip: false},
  );
  const stored = w.files.get('archive/uidA/lmu/s1/r1/samples.parquet');
  assert.equal(stored.bytes.toString(), 'parquet-bytes');
  assert.equal(
    await a.fileMd5(dest),
    createHash('md5').update(stored.bytes).digest('base64'),
  );
  await a.putFile(
    'bands/uidA/s1/v1.json.gz',
    {body: Buffer.from('{"a":1}')},
    {contentType: 'application/json', gzip: true},
  );
  assert.equal(
    gunzipSync(await a.getFile('bands/uidA/s1/v1.json.gz')).toString(),
    '{"a":1}',
  );
  assert.deepEqual(await a.listFiles('archive/lmu/s1/'), [dest]);
  await a.deleteFile(dest);
  assert.equal(await a.getFile(dest), null);

  // Another user sees none of it, and cannot touch it.
  const b = clientFor(w, 'tok-b');
  assert.equal(await b.getDoc('sessions', 's1'), null);
  assert.deepEqual(await b.sessionLapIds('s1'), []);
  await assert.rejects(
    b.writeDocs([
      {op: 'set', coll: 'sessions', id: 's1', data: {ownerId: 'uidB'}},
    ]),
    /403/,
  );
  await assert.rejects(b.getFile('traces/uidA/l1/v2.csv.gz'), /403/);
});

// -- uploader status (heartbeats) ------------------------------------------------

const beat = (overrides = {}) => ({
  hostId: 'a1b2c3d4',
  label: 'Race PC',
  version: '0.1.0',
  lmuFound: true,
  state: 'syncing',
  lastUploadAt: '2026-10-06T03:00:00Z',
  lastSessionId: 'bc1d',
  queue: 2,
  progress: {done: 1, total: 4},
  retryAt: null,
  sessionsDone: 14,
  lastError: null,
  disk: {captureBytes: 5e9, freeBytes: 2e11},
  recorder: {
    state: 'recording',
    gameVersion: '1.2',
    layoutOk: true,
    layoutReason: null,
    lastChunkAt: '2026-10-06T03:00:00Z',
    updatedAt: '2026-10-06T03:00:05Z',
  },
  ...overrides,
});
const NOW0 = Date.parse('2026-10-06T04:00:00Z');
const clockWorld = () => {
  const w = world();
  w.clock = {t: NOW0};
  w.deps.now = () => w.clock.t;
  return w;
};
const send = (w, token, body) =>
  call(w, token, 'POST', '/heartbeat', {json: body});

test('a heartbeat is stored under the token owner, stamped by the server', async () => {
  const w = clockWorld();
  const res = await send(
    w,
    'tok-a',
    beat({
      ownerId: 'botkin', // ignored
      lastSeenAt: '1999-01-01T00:00:00Z', // the server's clock wins
      serverUpdatedAt: 'x',
      secret: 'dropped',
    }),
  );
  assert.equal(res.status, 204);
  const doc = w.docs.get('uploaders/uidA__a1b2c3d4');
  assert.equal(doc.ownerId, 'uidA');
  assert.equal(doc.hostId, 'a1b2c3d4');
  assert.equal(doc.lastSeenAt, '2026-10-06T04:00:00.000Z');
  assert.equal(doc.serverUpdatedAt, '2026-10-06T04:00:00.000Z');
  assert.equal(
    doc.secret,
    undefined,
    'a field the card does not read is dropped',
  );
  assert.equal(doc.state, 'syncing');
  assert.deepEqual(doc.disk, {captureBytes: 5e9, freeBytes: 2e11});
  // Nothing was written outside uploaders/.
  assert.deepEqual(
    [...w.docs.keys()].filter(k => !k.startsWith('users/')),
    ['uploaders/uidA__a1b2c3d4'],
  );
});

test("the legacy owner's heartbeat is stamped botkin, and users cannot touch each other's host", async () => {
  const w = clockWorld();
  await send(w, 'tok-k', beat());
  await send(w, 'tok-a', beat({state: 'idle'}));
  await send(w, 'tok-b', beat({state: 'error'}));
  assert.equal(w.docs.get('uploaders/botkin__a1b2c3d4').ownerId, 'botkin');
  // The same hostId for two users is two documents, never one overwritten.
  assert.equal(w.docs.get('uploaders/uidA__a1b2c3d4').state, 'idle');
  assert.equal(w.docs.get('uploaders/uidB__a1b2c3d4').state, 'error');
  assert.equal(w.docs.get('uploaders/uidB__a1b2c3d4').ownerId, 'uidB');
});

test('heartbeats are not counted as documents or bytes, only as heartbeats (marshal #236)', async () => {
  const w = clockWorld();
  await send(w, 'tok-a', beat());
  w.clock.t += 40_000;
  await send(w, 'tok-a', beat({state: 'idle'}));
  assert.deepEqual(w.usage.get('uidA'), {
    docs: 0,
    docBytes: 0,
    files: 0,
    fileBytes: 0,
    heartbeats: 2,
  });
});

test('too often is 429 with Retry-After, and the latest state is accepted when allowed', async () => {
  const w = clockWorld();
  assert.equal((await send(w, 'tok-a', beat({state: 'syncing'}))).status, 204);
  // sync started, then finished 5 s later: the second is turned away...
  w.clock.t += 5_000;
  const early = await send(w, 'tok-a', beat({state: 'idle', queue: 0}));
  assert.equal(early.status, 429);
  assert.equal(early.headers['Retry-After'], '25');
  assert.equal(w.docs.get('uploaders/uidA__a1b2c3d4').state, 'syncing');
  assert.equal(
    w.usage.get('uidA').heartbeats,
    1,
    'a refused beat is not counted',
  );
  // ...and the tray sends its LATEST state after the wait, which replaces it.
  w.clock.t += 25_000;
  assert.equal(
    (await send(w, 'tok-a', beat({state: 'idle', queue: 0}))).status,
    204,
  );
  assert.equal(w.docs.get('uploaders/uidA__a1b2c3d4').state, 'idle');
  // Another host of the same user is not held up by this one.
  assert.equal(
    (await send(w, 'tok-a', beat({hostId: 'other-pc', state: 'idle'}))).status,
    204,
  );
});

test('a heartbeat needs a token and a safe host id', async () => {
  const w = clockWorld();
  assert.equal((await send(w, null, beat())).status, 401);
  for (const hostId of [
    '',
    '../x',
    'a/b',
    'a\\b',
    '.hidden',
    'x'.repeat(65),
    undefined,
    42,
    null,
  ])
    assert.equal(
      (await send(w, 'tok-a', beat({hostId}))).status,
      400,
      String(hostId),
    );
  assert.equal(w.docs.size, 1, 'only the users/uidK mapping exists');
});

test('a heartbeat is checked field by field', async () => {
  const w = clockWorld();
  const bad = [
    {label: undefined},
    {version: undefined},
    {lmuFound: 'yes'},
    {state: 'on fire'},
    {state: undefined},
    {queue: -1},
    {queue: 1.5e15},
    {queue: '2'},
    {sessionsDone: NaN},
    {progress: {done: 1}},
    {progress: 'half'},
    {lastError: {at: 'x', message: 'm'.repeat(301)}},
    {lastError: 'boom'},
    {disk: {captureBytes: 1}},
    {recorder: {state: 5}},
    {label: 'L'.repeat(65)},
    {lastSessionId: 'x'.repeat(65)},
  ];
  for (const patch of bad)
    assert.equal(
      (await send(w, 'tok-a', beat(patch))).status,
      400,
      JSON.stringify(patch),
    );
  // What the real tray sends is accepted, including nulls and epoch times.
  const ok = beat({
    lastUploadAt: 1790000000000,
    retryAt: null,
    progress: null,
    recorder: null,
    lastError: {at: '2026-10-06T03:00:00Z', message: 'EBUSY', path: null},
    lastSessionId: null,
  });
  assert.equal((await send(w, 'tok-a', ok)).status, 204);
  assert.equal(
    w.usage.get('uidA').heartbeats,
    1,
    'only the accepted one counted',
  );
});

test('the usage counters on a user that never sent a heartbeat have no heartbeats', async () => {
  const w = clockWorld();
  await write(w, 'tok-a', [lap('l1', 'uidA')]);
  assert.equal(w.usage.get('uidA').heartbeats, 0);
});
