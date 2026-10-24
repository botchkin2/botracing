import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  MAX_PRESETS,
  TOMBSTONE_DAYS,
  cleanPreset,
  handleFuelPresets,
} from '../src/fuelPresetsCore.ts';
import {Unauthorized} from '../src/ownerAccess.ts';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const preset = (id, over = {}) => ({
  id,
  name: `Rules ${id}`,
  length: {kind: 'min', value: 60},
  fuelL: 73,
  vePct: 100,
  veRatio: null,
  formationLap: true,
  mandatoryStops: 0,
  savedAt: '2026-10-20T10:00:00Z',
  ...over,
});

// The store only: the rules are fuelPresetsCore's own.
function world({owners = {'Bearer a': 'botkin', 'Bearer b': 'other'}} = {}) {
  const docs = new Map();
  const deps = {
    owner: async auth => {
      if (!owners[auth]) throw new Unauthorized('sign in');
      return owners[auth];
    },
    read: async owner => docs.get(owner) ?? null,
    writeIf: async (owner, baseVersion, next) => {
      const current = docs.get(owner) ?? {presets: [], removed: {}, version: 0, updatedAt: null};
      if (current.version !== baseVersion) return {ok: false, current};
      docs.set(owner, next);
      return {ok: true};
    },
    now: () => NOW,
  };
  return {deps, docs};
}
const put = (w, body, auth = 'Bearer a') =>
  handleFuelPresets(w.deps, 'PUT', auth, body);

test('a first read is an empty list at version 0, never an error', async () => {
  const w = world();
  const r = await handleFuelPresets(w.deps, 'GET', 'Bearer a');
  assert.deepEqual(r, {
    status: 200,
    body: {presets: [], removed: {}, version: 0, updatedAt: null},
  });
});

test('a write with the version it read is stored, the server adds 1 and stamps the time', async () => {
  const w = world();
  const r = await put(w, {presets: [preset('p1')], removed: {}, baseVersion: 0});
  assert.equal(r.status, 200);
  assert.equal(r.body.version, 1);
  assert.equal(r.body.updatedAt, '2026-10-24T12:00:00.000Z');
  const again = await handleFuelPresets(w.deps, 'GET', 'Bearer a');
  assert.deepEqual(again.body.presets, [preset('p1')]);
  const second = await put(w, {presets: [preset('p1'), preset('p2')], removed: {}, baseVersion: 1});
  assert.equal(second.body.version, 2);
});

test('a stale write is refused with 409 and the current doc, and changes nothing', async () => {
  const w = world();
  await put(w, {presets: [preset('p1')], removed: {}, baseVersion: 0});
  // another device read version 0 before that write and now sends its own list
  const stale = await put(w, {presets: [preset('mine')], removed: {}, baseVersion: 0});
  assert.equal(stale.status, 409);
  assert.equal(stale.body.version, 1);
  assert.deepEqual(stale.body.presets, [preset('p1')]);
  assert.equal(w.docs.get('botkin').presets[0].id, 'p1');
});

test('two writes on the same version: one wins, the other gets the 409', async () => {
  const w = world();
  const [a, b] = await Promise.all([
    put(w, {presets: [preset('a')], removed: {}, baseVersion: 0}),
    put(w, {presets: [preset('b')], removed: {}, baseVersion: 0}),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
});

test('each owner has their own list', async () => {
  const w = world();
  await put(w, {presets: [preset('p1')], removed: {}, baseVersion: 0});
  const other = await handleFuelPresets(w.deps, 'GET', 'Bearer b');
  assert.deepEqual(other.body.presets, []);
  const theirs = await put(w, {presets: [preset('q')], removed: {}, baseVersion: 0}, 'Bearer b');
  assert.equal(theirs.status, 200);
  assert.equal(w.docs.get('botkin').presets[0].id, 'p1');
});

test('no token is Unauthorized and nothing is read or written', async () => {
  const w = world();
  await assert.rejects(handleFuelPresets(w.deps, 'GET', undefined), Unauthorized);
  await assert.rejects(put(w, {presets: [], removed: {}, baseVersion: 0}, 'Bearer nope'), Unauthorized);
  assert.equal(w.docs.size, 0);
});

test('other methods are 405', async () => {
  const w = world();
  assert.equal((await handleFuelPresets(w.deps, 'POST', 'Bearer a', {})).status, 405);
  assert.equal((await handleFuelPresets(w.deps, 'DELETE', 'Bearer a')).status, 405);
});

test('a preset is typed field by field: unknown fields dropped, the rest checked', () => {
  const cleaned = cleanPreset({...preset('p1'), owner: 'x', extra: 1, name: '  Sebring  '});
  assert.deepEqual(cleaned, preset('p1', {name: 'Sebring'}));
  const bads = [
    {id: ''},
    {id: '../x'},
    {id: 'a b'},
    {name: ''},
    {name: 'x'.repeat(81)},
    {length: {kind: 'hours', value: 1}},
    {length: {kind: 'min', value: 0}},
    {fuelL: -1},
    {fuelL: '73'},
    {vePct: 101},
    {veRatio: 0},
    {formationLap: 'yes'},
    {mandatoryStops: 1.5},
    {savedAt: 'yesterday'},
  ];
  for (const bad of bads)
    assert.equal(typeof cleanPreset({...preset('p1'), ...bad}), 'string', JSON.stringify(bad));
  assert.equal(typeof cleanPreset(null), 'string');
  // null fuel and ratio are real: the fill limit of the last session, the measured ratio
  assert.equal(cleanPreset(preset('p1', {fuelL: null, veRatio: null})).fuelL, null);
});

test('a bad request is a 400 with the reason, and nothing is stored', async () => {
  const w = world();
  const cases = [
    [{presets: [preset('p1')], removed: {}}, /baseVersion/],
    [{presets: [preset('p1')], removed: {}, baseVersion: -1}, /baseVersion/],
    [{presets: [preset('p1')], removed: {}, baseVersion: 1.5}, /baseVersion/],
    [{presets: 'x', removed: {}, baseVersion: 0}, /list/],
    [{presets: [preset('p1'), preset('p1')], removed: {}, baseVersion: 0}, /two presets/],
    [{presets: [preset('p1', {name: ''})], removed: {}, baseVersion: 0}, /name/],
    [{presets: [], removed: [], baseVersion: 0}, /removed/],
    [{presets: [], removed: {'../x': '2026-10-20T00:00:00Z'}, baseVersion: 0}, /removed/],
    [{presets: [], removed: {p1: 'soon'}, baseVersion: 0}, /removed/],
  ];
  for (const [body, why] of cases) {
    const r = await put(w, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.error, why);
  }
  assert.equal((await put(w, 'text')).status, 400);
  assert.equal(w.docs.size, 0);
});

test(`at most ${MAX_PRESETS} presets`, async () => {
  const w = world();
  const many = Array.from({length: MAX_PRESETS + 1}, (_, i) => preset(`p${i}`));
  assert.equal((await put(w, {presets: many, removed: {}, baseVersion: 0})).status, 400);
  assert.equal((await put(w, {presets: many.slice(0, MAX_PRESETS), removed: {}, baseVersion: 0})).status, 200);
});

test(`a tombstone older than ${TOMBSTONE_DAYS} days is dropped on write, a newer one kept`, async () => {
  const w = world();
  const old = new Date(NOW - (TOMBSTONE_DAYS + 1) * 86_400_000).toISOString();
  const recent = new Date(NOW - 5 * 86_400_000).toISOString();
  const r = await put(w, {presets: [], removed: {gone: old, fresh: recent}, baseVersion: 0});
  assert.deepEqual(r.body.removed, {fresh: recent});
});
