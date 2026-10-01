import assert from 'node:assert/strict';
import {test} from 'node:test';
import {windowsOf} from '../../src/analysis/cornerBoundaries.ts';
import {sessionBoundaries, staleRev, unpackState} from './layoutBoundaries.mjs';
import {getBoundaries, putBoundaries, writeBoundaries} from './store.mjs';
import {LENGTH_M, makeLap, map} from './syntheticLap.mjs';

// An in-memory Firestore: documents by "collection/id", get, and a bulk
// writer whose set replaces a document or, with {merge: true}, merges into it.
function fakeDb() {
  const docs = new Map();
  const merge = (into, from) => {
    const out = {...into};
    for (const [k, v] of Object.entries(from)) out[k] = v;
    return out;
  };
  return {
    docs,
    collection: name => ({
      doc: id => ({
        path: `${name}/${id}`,
        get: async () => {
          const data = docs.get(`${name}/${id}`);
          return {exists: data !== undefined, data: () => data};
        },
      }),
    }),
    bulkWriter() {
      const queue = [];
      return {
        set: (ref, data, options) => queue.push([ref, data, options]),
        close: async () => {
          for (const [ref, data, options] of queue) {
            // What Firestore refuses: an array inside an array.
            const check = v => {
              if (Array.isArray(v)) {
                assert.ok(
                  !v.some(Array.isArray),
                  `nested array in ${ref.path}`,
                );
                v.forEach(check);
              } else if (v && typeof v === 'object')
                Object.values(v).forEach(check);
              assert.notEqual(v, undefined, `undefined in ${ref.path}`);
            };
            check(data);
            docs.set(
              ref.path,
              options?.merge ? merge(docs.get(ref.path) ?? {}, data) : data,
            );
          }
        },
      };
    },
  };
}

const TRACK = 'lmu-synthetic';
const fold = (stored, sessionId, laps) =>
  sessionBoundaries({
    laps: laps.map(l => l.lap),
    map,
    stored,
    sessionId,
    fold: {minLaps: 1, minSessions: 1},
  });
const lapsOf = (...brakes) => brakes.map(([a, b]) => makeLap(a, b));
const asBoundaries = r => ({
  trackId: TRACK,
  state: r.state,
  windows: r.windows,
});

test('nothing stored reads as null', async () => {
  assert.equal(await getBoundaries(TRACK, fakeDb()), null);
});

test('a fold is written, read back and equal; the track doc keeps its map and gains the summary', async () => {
  const db = fakeDb();
  db.docs.set(`tracks/${TRACK}`, {
    id: TRACK,
    corners: [{n: 1}],
    lengthM: LENGTH_M,
  });
  const r = fold(null, 's1', lapsOf([580, 1380], [590, 1390], [585, 1385]));
  const writer = db.bulkWriter();
  writeBoundaries(db, writer, asBoundaries(r));
  await writer.close();
  const read = unpackState(await getBoundaries(TRACK, db));
  assert.deepEqual(read, r.state);
  const track = db.docs.get(`tracks/${TRACK}`);
  assert.deepEqual(track.corners, [{n: 1}]);
  assert.equal(track.lengthM, LENGTH_M);
  assert.deepEqual(track.boundaries, {
    v: r.state.v,
    rev: r.state.rev,
    startsM: r.state.startsM,
    marginM: r.state.marginM,
    windows: r.windows,
  });
  assert.deepEqual(r.windows, windowsOf(r.state, map.corners, LENGTH_M));
});

test('a resync of the same session replaces its own contribution, a second session adds its own', async () => {
  const db = fakeDb();
  const first = fold(null, 's1', lapsOf([580, 1380], [590, 1390]));
  await putBoundaries(asBoundaries(first), db);
  const stored = unpackState(await getBoundaries(TRACK, db));
  // The same session again: nothing new, nothing doubled, nothing to write.
  const again = fold(stored, 's1', lapsOf([580, 1380], [590, 1390]));
  assert.equal(again.changed, false);
  assert.equal(again.moved, false);
  assert.deepEqual(again.state.sessions, stored.sessions);
  // A second session joins the first.
  const second = fold(stored, 's2', lapsOf([585, 1385]));
  assert.deepEqual(Object.keys(second.state.sessions).sort(), ['s1', 's2']);
  await putBoundaries(asBoundaries(second), db);
  const reread = unpackState(await getBoundaries(TRACK, db));
  assert.deepEqual(Object.keys(reread.sessions).sort(), ['s1', 's2']);
  // And folding s2 again leaves the pool as it is.
  const third = fold(reread, 's2', lapsOf([585, 1385]));
  assert.deepEqual(third.state.sessions, reread.sessions);
});

test('a session on an older rev is stale, one on the current rev or a layout without boundaries is not', () => {
  assert.equal(staleRev(1, 3), true);
  assert.equal(staleRev(undefined, 1), true);
  assert.equal(staleRev(3, 3), false);
  assert.equal(staleRev(2, null), false);
});
