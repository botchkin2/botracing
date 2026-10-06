import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  DEFAULT_RESYNC_CAP,
  catalogStamp,
  staleByCatalog,
} from './catalogStamp.mjs';
import {mapKeyOf} from './layoutBoundaries.mjs';
import {map} from './syntheticLap.mjs';

const trackMap = {mapVersion: 3, lengthM: map.lengthM, corners: map.corners};
const boundaries = {rev: 4, mapKey: mapKeyOf(map.corners)};

test('a track with no map in the catalog is "none"; otherwise map version, boundaries rev and map', () => {
  assert.equal(catalogStamp(null, null), 'none');
  assert.equal(catalogStamp(null, boundaries), 'none');
  assert.equal(
    catalogStamp({georef: 1}, boundaries),
    'none',
    'a track document with no corners is no map',
  );
  assert.equal(catalogStamp({corners: []}, boundaries), 'none');
  const s = catalogStamp(trackMap, boundaries);
  assert.match(s, /^m3:b4:[0-9a-f]{8}$/);
  assert.equal(
    catalogStamp(trackMap, boundaries),
    s,
    'the same data gives the same stamp',
  );
  assert.match(
    catalogStamp(trackMap, null),
    /^m3:bnone:/,
    'a map without boundaries is its own state',
  );
});

test('the curator catalogRev moves the stamp only once it is above 0, so old stamps stay valid', () => {
  const base = catalogStamp(trackMap, boundaries);
  assert.equal(catalogStamp({...trackMap, catalogRev: 0}, boundaries), base);
  assert.equal(
    catalogStamp({...trackMap, catalogRev: undefined}, boundaries),
    base,
  );
  const r1 = catalogStamp({...trackMap, catalogRev: 1}, boundaries);
  assert.equal(r1, base + ':r1');
  assert.notEqual(
    catalogStamp({...trackMap, catalogRev: 2}, boundaries),
    r1,
    'every curated apply is visible even when no start moved',
  );
});

test('every curated change moves the stamp: the map version, the boundaries rev, the map itself', () => {
  const base = catalogStamp(trackMap, boundaries);
  assert.notEqual(catalogStamp({...trackMap, mapVersion: 4}, boundaries), base);
  assert.notEqual(catalogStamp(trackMap, {...boundaries, rev: 5}), base);
  assert.notEqual(
    catalogStamp(trackMap, {...boundaries, rev: 3}),
    base,
    'a lower rev (a reverted edit) is a change too, not only a higher one',
  );
  // A re-cut map with the same rev and version still changes it.
  const recut = {
    ...trackMap,
    corners: map.corners.map(c => ({...c, exitM: c.exitM + 5})),
  };
  assert.notEqual(catalogStamp(recut, boundaries), base);
  // Things the curator did not change do not.
  assert.equal(
    catalogStamp(
      {...trackMap, lengthM: trackMap.lengthM},
      {...boundaries, mapKey: 'ignored'},
    ),
    base,
  );
});

// sessions newest first, as sync hands them over
const session = (id, trackId) => ({id, trackId});

test('a session whose track gained a map, or whose map was edited, is stale; an unchanged one is not', () => {
  const now = catalogStamp(trackMap, boundaries);
  const found = staleByCatalog({
    sessions: [session('a', 'spa'), session('b', 'spa'), session('c', 'spa')],
    stamps: {a: 'none', b: now, c: 'm3:b3:deadbeef'},
    current: new Map([['spa', now]]),
  });
  assert.deepEqual(
    [...found.stale],
    ['a', 'c'],
    '(a) none -> a map, (b) an edited map',
  );
  assert.equal(found.deferred, 0);
  assert.equal(found.adopt.size, 0);
});

test('the stamp is per track: editing one track re-analyses nobody on another', () => {
  const spa = catalogStamp(trackMap, boundaries);
  const daytona = catalogStamp(
    {...trackMap, mapVersion: 9},
    {rev: 1, mapKey: 'x'},
  );
  const stamps = {s1: spa, s2: spa, d1: daytona, d2: daytona};
  const sessions = [
    session('d2', 'daytona'),
    session('s2', 'spa'),
    session('d1', 'daytona'),
    session('s1', 'spa'),
  ];
  // The curator edits Daytona only.
  const editedDaytona = catalogStamp(
    {...trackMap, mapVersion: 9},
    {rev: 2, mapKey: 'x'},
  );
  const found = staleByCatalog({
    sessions,
    stamps,
    current: new Map([
      ['spa', spa],
      ['daytona', editedDaytona],
    ]),
  });
  assert.deepEqual(
    [...found.stale].sort(),
    ['d1', 'd2'],
    'only Daytona sessions',
  );
});

test('a session synced before stamps existed adopts the stamp as it is now and is not re-analysed', () => {
  const now = catalogStamp(trackMap, boundaries);
  const found = staleByCatalog({
    sessions: [session('old1', 'spa'), session('old2', 'spa')],
    stamps: {},
    current: new Map([['spa', now]]),
  });
  assert.equal(
    found.stale.size,
    0,
    'no storm on the first run after this ships',
  );
  assert.deepEqual(
    [...found.adopt],
    [
      ['old1', now],
      ['old2', now],
    ],
  );
  // Once adopted, a later edit does reach them.
  const edited = catalogStamp(trackMap, {...boundaries, rev: 5});
  const later = staleByCatalog({
    sessions: [session('old1', 'spa'), session('old2', 'spa')],
    stamps: {old1: now, old2: now},
    current: new Map([['spa', edited]]),
  });
  assert.equal(later.stale.size, 2);
});

test('a track the catalog was not asked about is left alone', () => {
  const found = staleByCatalog({
    sessions: [session('a', 'unknown-track')],
    stamps: {a: 'none'},
    current: new Map(),
  });
  assert.equal(found.stale.size + found.adopt.size + found.deferred, 0);
});

test('re-analysis is capped per run, newest first, and a busy track converges over several runs', () => {
  const now = catalogStamp(trackMap, boundaries);
  const ids = Array.from(
    {length: 10},
    (_, i) => `s${String(10 - i).padStart(2, '0')}`,
  ); // s10 newest ... s01
  const sessions = ids.map(id => session(id, 'spa'));
  const stamps = Object.fromEntries(ids.map(id => [id, 'old']));
  const current = new Map([['spa', now]]);
  const runs = [];
  for (let run = 0; run < 10; run++) {
    const {stale, deferred} = staleByCatalog({
      sessions,
      stamps,
      current,
      cap: 3,
    });
    if (stale.size === 0) break;
    runs.push({ids: [...stale], deferred});
    assert.ok(stale.size <= 3, 'never more than the cap in one run');
    for (const id of stale) stamps[id] = now; // the tray re-analysed and recorded them
  }
  assert.deepEqual(
    runs.map(r => r.ids),
    [
      ['s10', 's09', 's08'],
      ['s07', 's06', 's05'],
      ['s04', 's03', 's02'],
      ['s01'],
    ],
  );
  assert.deepEqual(
    runs.map(r => r.deferred),
    [7, 4, 1, 0],
    'each run says how many wait',
  );
  assert.deepEqual(
    Object.values(stamps),
    Array(10).fill(now),
    'and in the end all are current',
  );
  assert.equal(DEFAULT_RESYNC_CAP, 25);
});
