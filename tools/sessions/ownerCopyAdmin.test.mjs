import assert from 'node:assert/strict';
import {test} from 'node:test';
import {adminCopyBackend} from './ownerCopyAdmin.mjs';

// A shim with only what the adapter should call. Every query records its steps.
function shim({sessionDocs = []} = {}) {
  const calls = [];
  const queries = [];
  const file = path => ({
    getMetadata: async () => {
      if (path === 'missing') throw Object.assign(new Error('nf'), {code: 404});
      return [
        {
          size: '5',
          md5Hash: 'MD5',
          contentType: 'text/csv',
          contentEncoding: 'gzip',
          cacheControl: 'private',
        },
      ];
    },
    download: async opts => {
      calls.push(['download', path, opts]);
      return [Buffer.from('hello')];
    },
    save: async (bytes, opts) =>
      calls.push(['save', path, bytes.toString(), opts]),
    copy: async dest => calls.push(['copy', path, dest.name]),
    name: path,
  });
  const doc = path => ({
    get: async () => ({exists: path !== 'gone', data: () => ({path})}),
    set: async (data, opts) => calls.push(['set', path, data, opts]),
  });
  const query = (coll, steps = []) => {
    const q = {
      where: (f, op, v) => query(coll, [...steps, ['where', f, op, v]]),
      orderBy: f => query(coll, [...steps, ['orderBy', f]]),
      limit: n => query(coll, [...steps, ['limit', n]]),
      startAfter: d => query(coll, [...steps, ['startAfter', d.id]]),
      select: () => query(coll, [...steps, ['select']]),
      count: () => ({
        get: async () => {
          queries.push([coll, [...steps, ['count']]]);
          return {data: () => ({count: 42})};
        },
      }),
      get: async () => {
        queries.push([coll, steps]);
        const after = steps.find(s => s[0] === 'startAfter')?.[1];
        const limit = steps.find(s => s[0] === 'limit')?.[1] ?? Infinity;
        const all =
          coll === 'sessions' ? sessionDocs : [{id: 'x', data: () => ({coll})}];
        const from = after ? all.findIndex(d => d.id === after) + 1 : 0;
        return {docs: all.slice(from, from + limit)};
      },
    };
    return q;
  };
  const db = {doc, collection: coll => query(coll)};
  return {db, bucket: {file}, calls, queries};
}

test('sessions are read a page at a time by document id, never as one list', async () => {
  const docs = Array.from({length: 250}, (_, i) => ({
    id: `s${String(i).padStart(3, '0')}`,
    data: () => ({n: i}),
  }));
  const {db, bucket, queries} = shim({sessionDocs: docs});
  const b = adminCopyBackend({db, bucket});
  const seen = [];
  for await (const d of b.iterDocs('sessions', 'botkin')) seen.push(d.id);
  assert.equal(seen.length, 250);
  assert.equal(new Set(seen).size, 250, 'no session twice');
  assert.equal(queries.length, 3, 'three pages of at most 100');
  for (const [, steps] of queries) {
    assert.deepEqual(steps.slice(0, 3), [
      ['where', 'ownerId', '==', 'botkin'],
      ['orderBy', '__name__'],
      ['limit', 100],
    ]);
  }
  assert.deepEqual(
    queries[1][1][3],
    ['startAfter', 's099'],
    'the next page starts after the last document',
  );
});

test('ids come without fields, counts come from the database, a session is read by itself', async () => {
  const {db, bucket, queries} = shim();
  const b = adminCopyBackend({db, bucket});
  assert.deepEqual(await b.listIds('recordings', 'botkin'), ['x']);
  assert.deepEqual(
    queries.at(-1)[1],
    [['where', 'ownerId', '==', 'botkin'], ['select']],
    'no field is read',
  );
  assert.equal(await b.countDocs('laps', 'botkin'), 42);
  assert.deepEqual(queries.at(-1)[1], [
    ['where', 'ownerId', '==', 'botkin'],
    ['count'],
  ]);
  const laps = await b.listBySession('laps', 'abcd', 'botkin');
  assert.equal(laps.length, 1);
  assert.deepEqual(
    queries.at(-1)[1],
    [
      ['where', 'sessionId', '==', 'abcd'],
      ['where', 'ownerId', '==', 'botkin'],
    ],
    'two equality filters, no composite index needed',
  );
});

test('the Admin backend writes whole documents, copies server side, keeps metadata, and has nothing that deletes', async () => {
  const {db, bucket, calls} = shim();
  const b = adminCopyBackend({db, bucket});
  assert.deepEqual(
    Object.keys(b).filter(k => /delete|remove|clear/i.test(k)),
    [],
  );
  assert.equal(await b.getDoc('gone'), null);
  await b.setDoc('laps/y', {a: 1});
  assert.deepEqual(
    calls.at(-1),
    ['set', 'laps/y', {a: 1}, undefined],
    'a whole document, never a merge',
  );
  assert.deepEqual(await b.statFile('traces/a'), {
    size: 5,
    md5: 'MD5',
    contentType: 'text/csv',
    contentEncoding: 'gzip',
    cacheControl: 'private',
  });
  assert.equal(await b.statFile('missing'), null);
  const read = await b.readFile('traces/a');
  assert.deepEqual(
    calls.at(-1),
    ['download', 'traces/a', {decompress: false}],
    'a gzipped file is not decompressed on the way',
  );
  assert.equal(read.bytes.toString(), 'hello');
  await b.writeFile('slices/x', Buffer.from('z'), {
    contentType: 'application/json',
    contentEncoding: 'gzip',
    cacheControl: 'private',
  });
  assert.deepEqual(calls.at(-1), [
    'save',
    'slices/x',
    'z',
    {
      resumable: false,
      metadata: {
        contentType: 'application/json',
        contentEncoding: 'gzip',
        cacheControl: 'private',
      },
    },
  ]);
  await b.copyFile('a/b', 'c/d');
  assert.deepEqual(calls.at(-1), ['copy', 'a/b', 'c/d']);
});
