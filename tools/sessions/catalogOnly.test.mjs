import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {planTrackMap, trackMapSourceOf} from './analyze.mjs';
import {mapKeyOf, sessionBoundaries} from './layoutBoundaries.mjs';
import {windowsOf} from '../../src/analysis/cornerBoundaries.ts';
import {httpBackend} from './storeClient.mjs';
import {LENGTH_M, makeLap, map} from './syntheticLap.mjs';

// Track data is curated, not made by a user's sync (thread 2 #155).

// -- which map an analysis may use ---------------------------------------------------

const stored = {mapVersion: undefined, lengthM: LENGTH_M, corners: map.corners};
const goodBoundaries = {mapKey: mapKeyOf(map.corners)};

test('an admin analysis behaves as it always did: a fitting map is used, otherwise one may be built', () => {
  const fits = planTrackMap({
    trackMap: stored,
    boundaries: null,
    distanceM: 2010,
    catalogOnly: false,
  });
  assert.deepEqual(fits, {fits: true, usable: true, mayBuild: false});
  // Boundaries do not matter to the admin path.
  assert.equal(
    planTrackMap({
      trackMap: stored,
      boundaries: {mapKey: 'other'},
      distanceM: 2010,
      catalogOnly: false,
    }).usable,
    true,
  );
  const misfit = planTrackMap({
    trackMap: stored,
    boundaries: null,
    distanceM: 2200,
    catalogOnly: false,
  });
  assert.deepEqual(misfit, {fits: false, usable: false, mayBuild: true});
  const none = planTrackMap({
    trackMap: null,
    boundaries: null,
    distanceM: 2000,
    catalogOnly: false,
  });
  assert.deepEqual(none, {fits: false, usable: false, mayBuild: true});
});

test('a catalog-only analysis uses the curated map with its own boundaries, and never builds one', () => {
  const ok = planTrackMap({
    trackMap: stored,
    boundaries: goodBoundaries,
    distanceM: 1990,
    catalogOnly: true,
  });
  assert.deepEqual(ok, {fits: true, usable: true, mayBuild: false});
  for (const [what, args] of [
    [
      'no map in the catalog',
      {trackMap: null, boundaries: goodBoundaries, distanceM: 2000},
    ],
    [
      'a map that does not fit this lap length',
      {trackMap: stored, boundaries: goodBoundaries, distanceM: 2200},
    ],
    [
      'a map with no boundaries',
      {trackMap: stored, boundaries: null, distanceM: 2000},
    ],
    [
      'boundaries of another map',
      {trackMap: stored, boundaries: {mapKey: 'other'}, distanceM: 2000},
    ],
    [
      'no lap length at all',
      {trackMap: stored, boundaries: goodBoundaries, distanceM: undefined},
    ],
  ]) {
    const p = planTrackMap({...args, catalogOnly: true});
    assert.equal(p.usable, false, what);
    assert.equal(p.mayBuild, false, `${what}: nothing may be built`);
  }
});

test('where the map came from: stored, new, session, none, or null', () => {
  const built = laps => ({laps});
  assert.equal(
    trackMapSourceOf({
      usable: true,
      catalogOnly: false,
      built: null,
      trackMap: stored,
      minLaps: 8,
    }),
    'stored',
  );
  assert.equal(
    trackMapSourceOf({
      usable: true,
      catalogOnly: true,
      built: null,
      trackMap: stored,
      minLaps: 8,
    }),
    'stored',
  );
  assert.equal(
    trackMapSourceOf({
      usable: false,
      catalogOnly: false,
      built: built(9),
      trackMap: null,
      minLaps: 8,
    }),
    'new',
  );
  assert.equal(
    trackMapSourceOf({
      usable: false,
      catalogOnly: false,
      built: built(3),
      trackMap: null,
      minLaps: 8,
    }),
    'session',
  );
  assert.equal(
    trackMapSourceOf({
      usable: false,
      catalogOnly: false,
      built: built(9),
      trackMap: stored,
      minLaps: 8,
    }),
    'session',
  );
  assert.equal(
    trackMapSourceOf({
      usable: false,
      catalogOnly: false,
      built: null,
      trackMap: null,
      minLaps: 8,
    }),
    null,
  );
  // Catalog-only never reaches 'new' or 'session', whatever could have been built.
  for (const trackMap of [null, stored])
    assert.equal(
      trackMapSourceOf({
        usable: false,
        catalogOnly: true,
        built: built(99),
        trackMap,
        minLaps: 8,
      }),
      'none',
    );
});

// -- the boundaries: read, never folded ------------------------------------------------

const lapsOf = (...brakes) => brakes.map(([a, b]) => makeLap(a, b));
const fold = (storedState, sessionId, laps, extra = {}) =>
  sessionBoundaries({
    laps: laps.map(l => l.lap),
    map,
    stored: storedState,
    sessionId,
    fold: {minLaps: 1, minSessions: 1},
    ...extra,
  });

test('read-only boundaries are the curated ones exactly: nothing folded in, nothing changed', () => {
  const curated = fold(
    null,
    'curator',
    lapsOf([650, 1450], [652, 1452], [648, 1448]),
  ).state;
  const before = structuredClone(curated);
  const users = lapsOf([640, 1440], [700, 1500], [660, 1460]);

  const read = fold(curated, 'a-user', users, {readOnly: true});
  assert.deepEqual(
    read.state,
    before,
    'the state is the curated one, untouched',
  );
  assert.deepEqual(curated, before, 'the object passed in is not modified');
  assert.equal(read.changed, false);
  assert.equal(read.moved, false);
  assert.ok(
    !('a-user' in read.state.sessions),
    "the user's session is not in the layout",
  );
  assert.deepEqual(read.windows, windowsOf(before, map.corners, map.lengthM));
  // Onsets are still measured per lap, so corner facts can be cut.
  assert.equal(read.onsets.size, users.length);
  for (const onsets of read.onsets.values())
    assert.equal(onsets.length, map.corners.length);

  // The control: the ordinary path with the same input does fold the session in.
  const folded = fold(curated, 'a-user', users);
  assert.ok('a-user' in folded.state.sessions, 'the admin path folds');
});

test("read-only boundaries need this map's own stored boundaries", () => {
  const curated = fold(null, 'curator', lapsOf([650, 1450])).state;
  assert.throws(
    () => fold(null, 's', lapsOf([650, 1450]), {readOnly: true}),
    /need the stored boundaries/,
  );
  assert.throws(
    () =>
      fold({...curated, mapKey: 'another map'}, 's', lapsOf([650, 1450]), {
        readOnly: true,
      }),
    /need the stored boundaries/,
  );
});

// -- the store and the command line --------------------------------------------------------

test('the HTTP store refuses to send a write to track data, and nothing leaves the machine', async () => {
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    res.writeHead(204).end();
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const api = `http://127.0.0.1:${server.address().port}/api/upload`;
  const backend = httpBackend({api, token: () => 't'});
  for (const coll of ['tracks', 'trackBoundaries']) {
    await assert.rejects(
      backend.writeDocs([{op: 'set', coll, id: 'lmu-x', data: {id: 'lmu-x'}}]),
      /must not write track data/,
    );
  }
  // A lap is fine, and mixed in with a track write the whole batch is refused.
  await backend.writeDocs([
    {op: 'set', coll: 'laps', id: 'a-001', data: {id: 'a-001'}},
  ]);
  await assert.rejects(
    backend.writeDocs([
      {op: 'set', coll: 'laps', id: 'a-001', data: {id: 'a-001'}},
      {op: 'set', coll: 'tracks', id: 'lmu-x', data: {id: 'lmu-x'}},
    ]),
    /must not write track data/,
  );
  assert.equal(requests, 1, 'only the one clean batch was sent');
  server.closeAllConnections();
  server.close();
});

test('--rebuild-track is refused before anything else happens, for a remote sync and an Admin sync alike; only --local may still build maps', () => {
  const sync = fileURLToPath(new URL('./sync.mjs', import.meta.url));
  const refused =
    /--rebuild-track is not available except with --local: track maps are curated/;
  for (const args of [['--remote'], []]) {
    const r = spawnSync(
      process.execPath,
      [sync, ...args, '--rebuild-track', 'lmu-road-atlanta'],
      {
        encoding: 'utf8',
        env: {...process.env, LAP_TOKEN_FILE: '', LAP_API: ''},
      },
    );
    assert.equal(r.status, 2, `${args} ${r.stderr}`);
    assert.match(r.stderr, refused);
  }
  const local = spawnSync(
    process.execPath,
    [
      sync,
      '--local',
      '--owner',
      'uid-test',
      '--rebuild-track',
      'lmu-road-atlanta',
      '--folder',
      '/nope',
    ],
    {encoding: 'utf8', env: {...process.env, LAP_API: ''}},
  );
  assert.doesNotMatch(local.stderr, refused, 'local is for trying things');
});

test('a non-remote sync refuses to run without an owner', () => {
  const sync = fileURLToPath(new URL('./sync.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [sync, '--local', '--folder', '/nope'], {
    encoding: 'utf8',
    env: {...process.env, LAP_OWNER: '', LAP_API: '', LAP_TOKEN_FILE: ''},
  });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /An owner is required/);
});
