import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {packState} from '../sessions/layoutBoundaries.mjs';
import {
  buildFromSession,
  buildRefold,
  describeSession,
  LoaderError,
  pickSession,
} from './loader.mjs';
import {planAdd} from './plan.mjs';

const info = {
  sim: 'lmu',
  track: 'Road Atlanta',
  layout: 'Road Atlanta',
  car: 'GT3',
  sessionType: 'practice',
  recordedAt: '2026-09-20T10:00:00.000Z',
};
const session = id => ({
  id,
  files: [{id: `${id}-r1`, path: `/x/${id}.duckdb`, info}],
});
const adapter = {writeArchive() {}};
const gpsRec = {s: {lat_deg: [1], lon_deg: [2]}};
const noGpsRec = {s: {lat_deg: null, lon_deg: null}};
const workDir = mkdtempSync(join(tmpdir(), 'loader-'));

test('a session is picked by id prefix; short, unknown and ambiguous ids are refused', () => {
  const list = [
    session('aaaaaa1111'),
    session('aaaaaa2222'),
    session('bbbbbb3333'),
  ];
  assert.equal(pickSession(list, 'bbbbbb').id, 'bbbbbb3333');
  assert.throws(() => pickSession(list, 'aaa'), LoaderError);
  assert.throws(() => pickSession(list, 'cccccc'), /no session starting with/);
  assert.throws(() => pickSession(list, 'aaaaaa'), /matches 2 sessions/);
  assert.deepEqual(describeSession(list[0]), {
    id: 'aaaaaa1111',
    sim: 'lmu',
    track: 'Road Atlanta',
    layout: 'Road Atlanta',
    car: 'GT3',
    sessionType: 'practice',
    at: info.recordedAt,
    recordings: 1,
  });
});

test('a first-session build hands the plan the map, state, lap count and GPS; too few laps still reach the plan to be refused with the count', () => {
  const map = {
    mapVersion: 4,
    lengthM: 2000,
    stepM: 5,
    corners: [
      {n: 1, entryM: 650, turnInM: 700, apexM: 760, exitM: 820, parts: []},
    ],
  };
  const state = {v: 1, rev: 1, startsM: [700], marginM: [10], sessions: {}};
  const analyze = (recs, opts) => {
    assert.equal(
      opts.trackMap,
      undefined,
      'no stored map: built as a first session',
    );
    return {
      trackMap: map,
      trackMapSource: 'new',
      trackMapLaps: 9,
      boundaries: {state},
    };
  };
  const built = buildFromSession({
    adapter,
    session: session('aaaaaa1111'),
    workDir,
    deps: {load: () => gpsRec, analyze},
  });
  assert.equal(built.lapsUsed, 9);
  assert.equal(built.gps, true);
  assert.deepEqual(built.track, {
    name: 'Road Atlanta',
    variant: 'Road Atlanta',
  });
  assert.equal(built.map, map);
  assert.equal(built.boundaries, state);

  const few = buildFromSession({
    adapter,
    session: session('aaaaaa1111'),
    workDir,
    deps: {
      load: () => noGpsRec,
      analyze: () => ({
        trackMap: map,
        trackMapSource: 'session',
        trackMapLaps: 5,
        boundaries: null,
      }),
    },
  });
  assert.equal(few.boundaries, null);
  assert.equal(few.gps, false);
  const plan = planAdd({
    trackId: 'lmu-road-atlanta',
    current: {track: null, boundaries: null, catalogRev: 0},
    built: few,
    samples: [],
    blast: {sessions: 0},
  });
  assert.ok(
    plan.refusals.some(r => r.includes('only 5 clean laps')),
    plan.refusals.join('|'),
  );
  assert.ok(plan.refusals.some(r => r.includes('no GPS')));
});

test('a refold folds the sessions one after another, each onto the state the last left, and refuses one the live map does not fit', () => {
  const corners = [
    {n: 1, entryM: 650, turnInM: 700, apexM: 760, exitM: 820, parts: []},
  ];
  const track = {
    mapVersion: 4,
    lengthM: 2000,
    stepM: 5,
    corners,
    catalogRev: 1,
  };
  const stored = {
    v: 1,
    rev: 3,
    startsM: [700],
    marginM: [10],
    mapKey: 'k',
    sessions: {},
  };
  const seen = [];
  const analyze = (recs, opts) => {
    seen.push({
      id: opts.sessionId,
      rev: opts.boundaries.rev,
      map: opts.trackMap,
    });
    return {
      trackMapSource: 'stored',
      trackMapLaps: null,
      boundaries: {state: {...opts.boundaries, rev: opts.boundaries.rev + 1}},
    };
  };
  const built = buildRefold({
    adapter,
    sessions: [session('aaaaaa1111'), session('bbbbbb2222')],
    current: {track, boundaries: packState(stored)},
    workDir,
    deps: {load: () => gpsRec, analyze},
  });
  assert.deepEqual(
    seen.map(s => [s.id, s.rev]),
    [
      ['aaaaaa1111', 3],
      ['bbbbbb2222', 4],
    ],
  );
  assert.equal(seen[0].map, track);
  assert.equal(built.boundaries.rev, 5);
  assert.equal(built.map, track);
  assert.equal(built.sessionId, 'aaaaaa1111,bbbbbb2222');

  const misfit = () => ({trackMapSource: 'session', boundaries: null});
  assert.throws(
    () =>
      buildRefold({
        adapter,
        sessions: [session('aaaaaa1111')],
        current: {track, boundaries: packState(stored)},
        workDir,
        deps: {load: () => gpsRec, analyze: misfit},
      }),
    /does not fit the live map/,
  );
  assert.throws(
    () =>
      buildRefold({
        adapter,
        sessions: [session('aaaaaa1111')],
        current: {track: null, boundaries: null},
        workDir,
        deps: {load: () => gpsRec, analyze},
      }),
    /no curated map/,
  );
});
