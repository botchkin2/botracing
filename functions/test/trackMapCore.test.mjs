import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {
  mapEtag,
  notModified,
  surfaceEtag,
  trackIdOk,
} from '../src/trackMapCore.ts';

test('a track id is a sim-prefixed layout slug, nothing that could be a path', () => {
  for (const ok of [
    'lmu-michelin_raceway_road_atlanta',
    'lmu-autodromo_nazionale_monza',
    'iracing-127-full_course',
  ])
    assert.ok(trackIdOk(ok), ok);
  for (const bad of [
    '',
    'lmu',
    'lmu-',
    'LMU-monza',
    'lmu-monza/../x',
    'lmu-..',
    'lmu-monza/v1',
    '../tracks/x',
    'lmu monza',
    `lmu-${'a'.repeat(200)}`,
    null,
    42,
  ])
    assert.equal(trackIdOk(bad), false, String(bad));
});

test("the map's validator is the track doc's last write", () => {
  assert.equal(mapEtag({seconds: 1791595919, nanoseconds: 12}), '"m-1791595919.12"');
  assert.notEqual(
    mapEtag({seconds: 1, nanoseconds: 1}),
    mapEtag({seconds: 1, nanoseconds: 2}),
  );
});

test("the surface's validator is what surface.mjs stamps, so a 304 needs no download", () => {
  const stamped = {path: 'surface/x/v1.json.gz', updatedAt: '2026-10-09T21:00:00.000Z', laps: 412};
  assert.equal(surfaceEtag(stamped), '"s-2026-10-09T21:00:00.000Z-412"');
  // A fold adds laps and restamps: a new validator.
  assert.notEqual(surfaceEtag(stamped), surfaceEtag({...stamped, laps: 430}));
  // No surface yet, or one written before the stamp: nothing to serve.
  assert.equal(surfaceEtag(null), null);
  assert.equal(surfaceEtag({path: 'surface/x/v1.json.gz'}), null);
});

test('a client holding the validator gets a 304; anything else gets the body', () => {
  const etag = '"m-5.6"';
  assert.ok(notModified('"m-5.6"', etag));
  assert.ok(notModified('W/"m-5.6"', etag));
  assert.ok(notModified('"other", "m-5.6"', etag));
  assert.ok(notModified('*', etag));
  assert.equal(notModified('"m-5.7"', etag), false);
  assert.equal(notModified(undefined, etag), false);
  assert.equal(notModified('', etag), false);
});

// The route itself is bound to Firestore and Storage: its shape is checked in
// the source, as ownerAccess.test.mjs does for the other readers.
const api = readFileSync(new URL('../src/lmuApi.ts', import.meta.url), 'utf8');

test('the track routes check the id, send an ETag, answer a 304, and never cache publicly', () => {
  const route = api.split("const trackRoute = path.match(")[1]?.split('\n      if (/')[0] ?? '';
  assert.ok(route, 'the /tracks/{id}/map|surface route is missing');
  assert.match(route, /trackIdOk\(trackId\)/);
  assert.match(route, /res\.set\('ETag', found\.etag\)/);
  assert.match(route, /notModified\(req\.headers\['if-none-match'\], found\.etag\)/);
  assert.match(route, /status\(304\)/);
  assert.doesNotMatch(route, /public|s-maxage/);
  // After the owner check, like every other route: only signed-in users.
  assert.ok(api.indexOf('const trackRoute') > api.indexOf('resolveOwner('));
});
