import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {gzipSync} from 'node:zlib';
import {adminCopyBackend} from './ownerCopyAdmin.mjs';
import {
  checkRead,
  compareSnapshots,
  snapshotSessions,
  withoutIds,
} from './ownerCopyApi.mjs';
import {idMapJson, makeMaps} from './ownerCopy.mjs';
import {ownerData} from './ownerCopyFixture.mjs';

// -- the command line: its guards run before any credential is touched --------
const cli = (...args) =>
  spawnSync(
    process.execPath,
    [
      new URL('./migrateOwner.mjs', import.meta.url).pathname.replace(
        /^\/([A-Za-z]:)/,
        '$1',
      ),
      ...args,
    ],
    {encoding: 'utf8'},
  );

test('the tool refuses an apply without a backup statement, and obvious mistakes, before connecting to anything', () => {
  const uid = 'LwTNOO0lF7QnEx847fvEGr4EKRF3';
  let r = cli('apply', '--to', uid);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--backup-confirmed/);
  r = cli('apply', '--to', uid, '--backup-confirmed', '   ');
  assert.equal(r.status, 2, 'a blank statement is no statement');
  r = cli('plan');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--to <uid> is required/);
  r = cli('plan', '--to', 'botkin');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /same/);
  r = cli('plan', '--to', '../etc');
  assert.equal(r.status, 2);
  r = cli('delete', '--to', uid);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown command/);
});

// -- the API check ---------------------------------------------------------------
const session = (id, extra = {}) => ({
  id,
  series: 'Botkin Cup',
  startedAt: '2026-09-20',
  track: {name: 'RA'},
  recordingIds: [`${id}r`],
  ...extra,
});

function fakeFetch(routes) {
  const seen = [];
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname.replace('/api/lmu', '');
    seen.push({path, auth: init.headers?.authorization});
    const hit = routes(path, init);
    const [status, body, binary] = hit ?? [404, {}];
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      arrayBuffer: async () => binary ?? new ArrayBuffer(0),
    };
  };
  return {fetch, seen};
}

test('ids are not part of what a session says, so a copy lists the same as its original', async () => {
  assert.deepEqual(
    withoutIds({
      id: 'a',
      ownerId: 'x',
      recordingIds: ['r'],
      series: 'S',
      bestLapId: 'l',
      nested: {sessionId: 's', keep: 1},
    }),
    {series: 'S', nested: {keep: 1}},
  );
  const old = fakeFetch(() => [
    200,
    {
      total: 2,
      items: [session('aaaa'), session('bbbb', {startedAt: '2026-09-23'})],
    },
  ]);
  const copy = fakeFetch(() => [
    200,
    {
      total: 2,
      items: [session('cccc', {startedAt: '2026-09-23'}), session('dddd')],
    },
  ]);
  const before = await snapshotSessions(old.fetch, {api: 'https://x/api/lmu'});
  const after = await snapshotSessions(copy.fetch, {
    api: 'https://x/api/lmu',
    token: 'T',
  });
  assert.deepEqual(compareSnapshots(before, after), []);
  assert.equal(copy.seen[0].auth, 'Bearer T');
  assert.equal(
    old.seen[0].auth,
    undefined,
    'the baseline is the anonymous read',
  );
});

test('a changed session, or a missing one, is a difference', async () => {
  const mk = items =>
    snapshotSessions(
      fakeFetch(() => [200, {total: items.length, items}]).fetch,
      {api: 'https://x/api/lmu'},
    );
  const before = await mk([
    session('a'),
    session('b', {startedAt: '2026-09-23'}),
  ]);
  assert.ok(
    compareSnapshots(before, await mk([session('c')])).some(d =>
      d.includes('2 sessions before, 1 after'),
    ),
  );
  const changed = await mk([
    session('c'),
    session('d', {startedAt: '2026-09-24'}),
  ]);
  assert.ok(
    compareSnapshots(before, changed).some(d =>
      d.includes('not the same after'),
    ),
  );
});

test("a copied session is read through the API: laps, a lap's telemetry and its track surface", async () => {
  const ok = fakeFetch(path => {
    if (path.endsWith('/laps')) return [200, {items: [{id: 'lap-001'}]}];
    if (path.includes('/laps/') && path.endsWith('/csv')) return [200, {}];
    if (path.endsWith('/surface'))
      return [200, {}, gzipSync(Buffer.from('{"bins":[1]}'))];
    return null;
  });
  const good = await checkRead(ok.fetch, {
    api: 'https://x/api/lmu',
    token: 'T',
    newIds: ['aaaaaaaaaaaaaaaa'],
  });
  assert.deepEqual(good, {diffs: [], notes: []});
  assert.ok(
    ok.seen.every(s => s.auth === 'Bearer T'),
    'every read carries the token',
  );

  const bad = fakeFetch(path =>
    path.endsWith('/laps')
      ? [200, {items: [{id: 'lap-001'}]}]
      : path.endsWith('/csv')
      ? [404, {}]
      : path.endsWith('/surface')
      ? [404, {}]
      : null,
  );
  const r = await checkRead(bad.fetch, {
    api: 'https://x/api/lmu',
    token: 'T',
    newIds: ['aaaaaaaaaaaaaaaa'],
    requireSurface: ['aaaaaaaaaaaaaaaa'],
  });
  assert.ok(r.diffs.some(d => d.includes('telemetry answered 404')));
  assert.ok(r.diffs.some(d => d.includes('surface answered 404')));
  // Not required: a note, not a failure.
  const soft = await checkRead(bad.fetch, {
    api: 'https://x/api/lmu',
    token: 'T',
    newIds: ['aaaaaaaaaaaaaaaa'],
  });
  assert.ok(soft.notes.some(n => n.includes('surface answered 404')));
});

// -- the Admin adapter, against a shim that has only what it should call --------
test('the Admin backend writes whole documents, copies server side, keeps metadata, and has nothing that deletes', async () => {
  const calls = [];
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
  const db = {
    doc,
    collection: coll => ({
      where: (f, op, v) => ({
        get: async () => ({docs: [{id: 'x', data: () => ({coll, f, op, v})}]}),
      }),
    }),
  };
  const bucket = {file};
  const b = adminCopyBackend({db, bucket});

  assert.deepEqual(
    Object.keys(b).filter(k => /delete|remove|clear/i.test(k)),
    [],
  );
  assert.deepEqual(await b.listDocs('laps', 'botkin'), [
    {id: 'x', data: {coll: 'laps', f: 'ownerId', op: '==', v: 'botkin'}},
  ]);
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

test('the id map is plain JSON saying which new id is which old one', () => {
  const d = ownerData('botkin');
  const recordings = [...d.docs]
    .filter(([k]) => k.startsWith('recordings/'))
    .map(([, v]) => v);
  const sessions = [...d.docs]
    .filter(([k]) => k.startsWith('sessions/'))
    .map(([, v]) => v);
  const laps = [...d.docs]
    .filter(([k]) => k.startsWith('laps/'))
    .map(([, v]) => v);
  const {maps} = makeMaps('botkin', 'U'.repeat(28), {
    recordings,
    sessions,
    laps,
  });
  const json = JSON.parse(JSON.stringify(idMapJson(maps)));
  assert.equal(json.from, 'botkin');
  assert.equal(Object.keys(json.sessions).length, 2);
  assert.equal(Object.keys(json.laps).length, 12);
  assert.ok(
    Object.values(json.sessions).every(id => /^[0-9a-f]{16}$/.test(id)),
  );
});
