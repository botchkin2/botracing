import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {
  ANONYMOUS_OWNER,
  Unauthorized,
  pathInsideOwner,
  resolveOwner,
  trustedTrackPath,
} from '../src/ownerAccess.ts';

const deps = (mapping = {}) => ({
  verifyToken: async token => {
    const uid = {'tok-a': 'uidA', 'tok-k': 'uidK', 'tok-empty': ''}[token];
    if (uid === undefined) throw new Error('bad');
    return {uid};
  },
  readOwnerKey: async uid => mapping[uid] ?? null,
});

test('no Authorization header is refused: anonymous access is closed', async () => {
  assert.equal(ANONYMOUS_OWNER, null);
  await assert.rejects(resolveOwner(deps(), undefined), Unauthorized);
});

test('a deliberate bridge can still name an anonymous owner', async () => {
  assert.equal(await resolveOwner(deps(), undefined, 'botkin'), 'botkin');
});

test('a verified token is the uid, or the admin-mapped key', async () => {
  assert.equal(await resolveOwner(deps(), 'Bearer tok-a'), 'uidA');
  assert.equal(
    await resolveOwner(deps({uidK: 'botkin'}), 'Bearer tok-k'),
    'botkin',
  );
});

test('a bad token never falls back to the anonymous owner', async () => {
  for (const header of [
    'Bearer nope',
    'Bearer ',
    'Basic tok-a',
    'tok-a',
    'Bearer tok-empty',
  ])
    await assert.rejects(resolveOwner(deps(), header), Unauthorized, header);
});

test('an unsafe mapped key is ignored in favour of the uid', async () => {
  assert.equal(
    await resolveOwner(deps({uidA: '../botkin'}), 'Bearer tok-a'),
    'uidA',
  );
});

test('a path is followed only inside the right folder of the owner', () => {
  const ok = [
    ['band', 'uidA', 'bands/uidA/s1/v1.json.gz'],
    ['field', 'botkin', 'field/botkin/s1/abc123.json.gz'],
    ['slices', 'uidA', 'slices/uidA/s1/abc123/c3.json.gz'],
  ];
  for (const [kind, owner, path] of ok)
    assert.equal(pathInsideOwner(kind, owner, path), path, path);

  const refused = [
    ['band', 'uidB', 'bands/uidA/s1/v1.json.gz'], // another owner's file
    ['band', 'uidB', 'bands/uidB/../uidA/s1/v1.json.gz'], // climbs out
    ['band', 'uidB', 'bands/uidB/x/../../../traces/botkin/l1/v2.csv.gz'],
    ['band', 'uidB', 'traces/botkin/l1/v2.csv.gz'], // wrong folder
    ['band', 'uidB', 'bands/uidB//x'], // empty segment
    ['band', 'uidB', 'bands/uidB/.hidden/x'], // dot-leading segment
    ['band', 'uidB', 'bands/uidB\\..\\uidA/x'], // backslashes
    ['band', 'uidB', 'bands/uidB/'], // nothing after the owner
    ['band', 'uidB', 'bands/uidB'],
    ['field', 'uidB', 'bands/uidB/s1/v1.json.gz'], // right owner, wrong kind
    ['slices', 'uidB', '/slices/uidB/s1/x'],
    ['band', 'uidB', 'bands/uidB%2F..%2FuidA/x'.replace('%2F', '/')],
    ['band', 'uidB', undefined],
    ['band', 'uidB', 42],
    ['band', 'uidB', {path: 'bands/uidB/x/y'}],
  ];
  for (const [kind, owner, path] of refused)
    assert.equal(pathInsideOwner(kind, owner, path), null, String(path));
});

test("a track doc's file paths are only trusted for the legacy owner", () => {
  assert.equal(
    trustedTrackPath('botkin', 'surface/lmu-road/v1.json.gz'),
    'surface/lmu-road/v1.json.gz',
  );
  assert.equal(trustedTrackPath('uidB', 'traces/botkin/l1/v2.csv.gz'), null);
  assert.equal(trustedTrackPath('botkin', undefined), null);
});

// The readers are bound to Firestore and Storage, which no test here can run,
// so the shape that matters is checked in the source: no baked-in owner, every
// exported reader takes the owner first, nothing is ever cached publicly.
const store = readFileSync(
  new URL('../src/sessionStore.ts', import.meta.url),
  'utf8',
);
const api = readFileSync(new URL('../src/lmuApi.ts', import.meta.url), 'utf8');

test('sessionStore has no baked-in owner and every reader takes the owner first', () => {
  assert.doesNotMatch(store, /\bOWNER\b/);
  const exported = [
    ...store.matchAll(/export async function (\w+)\(\s*([^)]*?)[,)]/g),
  ];
  const open = ['readTrackMap', 'readSurfaceGzip'];
  assert.ok(exported.length >= 12, `found ${exported.length} readers`);
  for (const [, name, firstArg] of exported)
    assert.match(
      firstArg.trim(),
      /^owner: string/,
      `${name} must take the owner first, got "${firstArg.trim()}"`,
    );
  assert.ok(open.every(n => exported.some(([, name]) => name === n)));
});

test('every stored-file read goes through the path guard or builds its own path', () => {
  assert.equal((store.match(/pathInsideOwner\(/g) ?? []).length, 3);
  assert.equal((store.match(/trustedTrackPath\(/g) ?? []).length, 2);
  // No download of a path taken straight from a doc.
  assert.doesNotMatch(store, /\.file\(\s*(session|track|slices)\./);
});

test('laps are read by owner as well as session', () => {
  const lapQueries = store.split(".collection('laps')").slice(1);
  assert.ok(lapQueries.length >= 2);
  for (const q of lapQueries)
    assert.match(q.slice(0, 200), /where\('ownerId', '==', owner\)/);
});

test('no response is cacheable by a shared cache, and Authorization varies it', () => {
  const values = [...api.matchAll(/Cache-Control',\s*([^)]*)\)/g)].map(
    m => m[1],
  );
  assert.ok(values.length >= 2);
  for (const v of values) {
    assert.doesNotMatch(v, /public/);
    assert.doesNotMatch(v, /s-maxage/);
  }
  assert.match(api, /set\('Vary', 'Authorization, Origin'\)/);
});
