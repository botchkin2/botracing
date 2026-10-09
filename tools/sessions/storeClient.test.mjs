import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {gunzipSync} from 'node:zlib';
import {createStore} from './store.mjs';
import {
  CHUNK_OPS,
  chunked,
  httpBackend,
  httpStore,
  uidOfToken,
} from './storeClient.mjs';
import {foldsSurface, openRemoteStore} from './remoteStore.mjs';

const jwt = claims =>
  `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

// A stand-in upload function: records requests, answers from `routes`.
async function stub(routes) {
  const seen = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const url = new URL(req.url, 'http://x');
    const entry = {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      auth: req.headers.authorization,
      type: req.headers['content-type'],
      body: Buffer.concat(chunks),
    };
    seen.push(entry);
    const answer = routes?.(entry, seen.length) ?? [204];
    const [status, body] = answer;
    res.writeHead(status, {'content-type': 'application/json'});
    res.end(body === undefined ? undefined : JSON.stringify(body));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const api = `http://127.0.0.1:${server.address().port}/api/upload`;
  return {
    seen,
    api,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

test('requests carry the current token, and a missing document is null', async () => {
  const s = await stub(({path}) =>
    path.endsWith('/me') ? [200, {ownerKey: 'u1'}] : [404],
  );
  let n = 0;
  const store = httpStore({api: s.api, token: () => `tok${++n}`});
  assert.deepEqual(await store.me(), {ownerKey: 'u1'});
  assert.equal(await store.getTrack('t/1'), null);
  assert.deepEqual(
    s.seen.map(r => [r.path, r.auth]),
    [
      ['/api/upload/me', 'Bearer tok1'],
      ['/api/upload/doc/tracks/t%2F1', 'Bearer tok2'],
    ],
  );
  s.close();
});

test('a document the shape check refuses is never sent', async () => {
  const s = await stub(() => [204]);
  const backend = httpBackend({api: s.api, token: () => 't'});
  await assert.rejects(
    backend.writeDocs([
      {
        op: 'set',
        coll: 'laps',
        id: 'a',
        data: {bad: undefined, nested: {x: undefined}},
      },
    ]),
  );
  assert.equal(s.seen.length, 0);
  s.close();
});

test('a 503 is retried, a 403 is not', async () => {
  let calls = 0;
  const s = await stub(({path}) => {
    if (path.endsWith('/laps')) return [403, {error: 'no'}];
    return ++calls < 2 ? [503] : [200, {ids: ['a']}];
  });
  const backend = httpBackend({api: s.api, token: () => 't'});
  await assert.rejects(backend.sessionLapIds('s'), /403/);
  assert.equal(s.seen.length, 1);
  s.close();
});

test('files go up by a signed URL, gzipped by the client when asked', async () => {
  const s = await stub(({path}) =>
    path.endsWith('/upload-url')
      ? [200, {url: `${s.api}/signed`, headers: {'x-goog': 'v'}}]
      : [204],
  );
  const backend = httpBackend({api: s.api, token: () => 't'});
  const dir = mkdtempSync(join(tmpdir(), 'store-'));
  writeFileSync(join(dir, 'a.parquet'), 'PAR1');
  await backend.putFile(
    'archive/x',
    {localPath: join(dir, 'a.parquet')},
    {contentType: 'application/vnd.apache.parquet'},
  );
  await backend.putFile(
    'traces/o/l/v2.csv.gz',
    {body: Buffer.from('a,b')},
    {contentType: 'text/csv', gzip: true},
  );
  const [ask1, put1, ask2, put2] = s.seen;
  assert.deepEqual(JSON.parse(ask1.body), {
    dest: 'archive/x',
    contentType: 'application/vnd.apache.parquet',
    gzip: false,
    size: 4,
  });
  assert.equal(put1.method + put1.body, 'PUTPAR1');
  assert.equal(put1.auth, undefined);
  assert.equal(JSON.parse(ask2.body).gzip, true);
  assert.equal(gunzipSync(put2.body).toString(), 'a,b');
  s.close();
});

test('uidOfToken reads user_id, then sub', () => {
  assert.equal(uidOfToken(jwt({user_id: 'u', sub: 's'})), 'u');
  assert.equal(uidOfToken(jwt({sub: 's'})), 's');
  assert.throws(() => uidOfToken('nope'));
});

test('openRemoteStore needs a token file holding a token', async () => {
  await assert.rejects(openRemoteStore({}), /LAP_TOKEN_FILE/);
  const dir = mkdtempSync(join(tmpdir(), 'store-'));
  writeFileSync(join(dir, 'bad'), 'x');
  await assert.rejects(openRemoteStore({LAP_TOKEN_FILE: join(dir, 'bad')}));
  writeFileSync(join(dir, 'ok'), jwt({user_id: 'u'}));
  assert.ok(await openRemoteStore({LAP_TOKEN_FILE: join(dir, 'ok')}));
});

// An in-memory backend: upload over it must behave the same whoever backs it.
function memoryBackend() {
  const docs = new Map();
  const files = new Map();
  return {
    docs,
    files,
    getDoc: async (c, i) => docs.get(`${c}/${i}`) ?? null,
    writeDocs: async ops => {
      for (const {op, coll, id, data, merge} of ops) {
        const key = `${coll}/${id}`;
        if (op === 'delete') docs.delete(key);
        else docs.set(key, merge ? {...docs.get(key), ...data} : data);
      }
    },
    updateDocs: async () => [],
    sessionLapIds: async sid =>
      [...docs]
        .filter(([k, d]) => k.startsWith('laps/') && d.sessionId === sid)
        .map(([k]) => k.slice(5)),
    fileMd5: async () => null,
    putFile: async (dest, source) => files.set(dest, source),
    getFile: async () => null,
    deleteFile: async dest => files.delete(dest),
    listFiles: async prefix =>
      [...files.keys()].filter(k => k.startsWith(prefix)),
  };
}

const out = laps => ({
  session: {id: 's1', ownerId: 'o', sessionType: 'practice', field: null},
  recordings: [{id: 'r1'}],
  laps: laps.map(id => ({
    id,
    sessionId: 's1',
    lapTime: 90,
    comparable: true,
    traffic: null,
  })),
  files: [],
  traces: [{dest: 'traces/o/l1/v2.csv.gz', csv: () => 'a,b\n1,2\n'}],
  band: null,
  fieldText: null,
});

test('upload writes the session, and a resync with fewer laps drops the rest', async () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  await store.upload(out(['l1', 'l2']));
  assert.deepEqual([...backend.docs.keys()].sort(), [
    'laps/l1',
    'laps/l2',
    'recordings/r1',
    'sessions/s1',
  ]);
  await store.upload(out(['l1']));
  assert.deepEqual([...backend.docs.keys()].sort(), [
    'laps/l1',
    'recordings/r1',
    'sessions/s1',
  ]);
  assert.ok(backend.files.has('traces/o/l1/v2.csv.gz'));
});

test('a big write goes in chunks, the session document last', async () => {
  const s = await stub();
  const backend = httpBackend({api: s.api, token: () => 't'});
  const laps = Array.from({length: CHUNK_OPS * 2 + 5}, (_, i) => ({
    op: 'set',
    coll: 'laps',
    id: `l${i}`,
    data: {sessionId: 's1'},
  }));
  const session = {op: 'set', coll: 'sessions', id: 's1', data: {id: 's1'}};
  await backend.writeDocs([
    session,
    ...laps,
    {op: 'delete', coll: 'laps', id: 'old'},
  ]);
  const sizes = s.seen.map(r => JSON.parse(r.body).ops.length);
  assert.deepEqual(sizes, [CHUNK_OPS, CHUNK_OPS, 7]);
  const last = JSON.parse(s.seen.at(-1).body).ops;
  assert.deepEqual(last.at(-1), session);
  assert.ok(
    s.seen
      .slice(0, -1)
      .every(r => JSON.parse(r.body).ops.every(o => o.coll !== 'sessions')),
  );
  s.close();
});

test('chunks also split on size', () => {
  const big = i => ({
    op: 'set',
    coll: 'laps',
    id: `l${i}`,
    data: {x: 'y'.repeat(1_500_000)},
  });
  assert.deepEqual(
    chunked([big(1), big(2), big(3)]).map(c => c.length),
    [2, 1],
  );
});

test('an unknown user is an error, not a null owner', async () => {
  const s = await stub(() => [404]);
  await assert.rejects(
    httpStore({api: s.api, token: () => 't'}).me(),
    /no owner key/,
  );
  s.close();
});

test('the surface is folded only by a sync that has Admin credentials', () => {
  assert.equal(foldsSurface({local: false, remote: false, tracks: 2}), true);
  assert.equal(foldsSurface({local: false, remote: true, tracks: 2}), false, 'remote has no Admin credentials');
  assert.equal(foldsSurface({local: true, remote: false, tracks: 2}), false, '--local uploads nothing');
  assert.equal(foldsSurface({local: false, remote: false, tracks: 0}), false, 'nothing uploaded');
});
