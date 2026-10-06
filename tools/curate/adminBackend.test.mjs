import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sessionBoundaries} from '../sessions/layoutBoundaries.mjs';
import {makeLap, map as synthMap} from '../sessions/syntheticLap.mjs';
import {PlanRefused, applyPlan} from './apply.mjs';
import {adminBackend} from './adminBackend.mjs';
import {planAdd, planUndo} from './plan.mjs';

// A Firestore stand-in with the parts the backend uses: documents in maps,
// transactions that apply their writes only if the function finishes.
const DELETE = Symbol('delete');
function fakeDb(seed = {}) {
  const data = {
    tracks: new Map(),
    trackBoundaries: new Map(),
    trackHistory: new Map(),
    sessions: new Map(),
  };
  for (const [coll, docs] of Object.entries(seed))
    for (const [id, doc] of Object.entries(docs))
      data[coll].set(id, structuredClone(doc));
  const snap = (coll, id) => ({
    exists: data[coll].has(id),
    data: () => structuredClone(data[coll].get(id)),
  });
  const ref = (coll, id) => ({coll, id, get: async () => snap(coll, id)});
  const query = (coll, field, value) => {
    const docs = () => [...data[coll].values()].filter(d => d[field] === value);
    const q = {
      select: () => q,
      get: async () => ({
        docs: docs().map(d => ({data: () => structuredClone(d)})),
      }),
      count: () => ({
        get: async () => ({data: () => ({count: docs().length})}),
      }),
    };
    return q;
  };
  const db = {
    data,
    transactions: 0,
    collection: coll => ({
      doc: id => ref(coll, id),
      where: (f, _op, v) => query(coll, f, v),
    }),
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get: async r => snap(r.coll, r.id),
        create: (r, doc) =>
          writes.push(() => {
            if (data[r.coll].has(r.id)) throw new Error('exists');
            data[r.coll].set(r.id, structuredClone(doc));
          }),
        set: (r, doc) =>
          writes.push(() => data[r.coll].set(r.id, structuredClone(doc))),
        update: (r, patch) =>
          writes.push(() => {
            const doc = {...data[r.coll].get(r.id)};
            for (const [k, v] of Object.entries(patch)) {
              if (v === DELETE) delete doc[k];
              else doc[k] = structuredClone(v);
            }
            data[r.coll].set(r.id, doc);
          }),
        delete: r => writes.push(() => data[r.coll].delete(r.id)),
      };
      await fn(tx);
      db.transactions++;
      for (const w of writes) w();
    },
  };
  return db;
}
const FieldValue = {delete: () => DELETE};

const MAP = {
  mapVersion: 4,
  lengthM: synthMap.lengthM,
  stepM: 5,
  corners: synthMap.corners,
};
const state = sessionBoundaries({
  laps: [
    [650, 1450],
    [652, 1452],
    [648, 1448],
  ].map(([a, b]) => makeLap(a, b).lap),
  map: {lengthM: MAP.lengthM, corners: synthMap.corners},
  stored: null,
  sessionId: 'built',
  fold: {minLaps: 1, minSessions: 1},
}).state;
const built = {
  map: MAP,
  boundaries: state,
  lapsUsed: 12,
  gps: true,
  sessionId: 's1',
  sim: 'lmu',
  track: {name: 'Road Atlanta', variant: 'Road Atlanta'},
};
const ID = 'lmu-road_atlanta';
const NOW = () => new Date('2026-10-06T12:00:00Z');

test('reads: the live catalog, the history, and the sessions on the track', async () => {
  const db = fakeDb({
    sessions: {
      a: {trackId: ID, band: {lengthM: 2001}},
      b: {trackId: ID, band: {lengthM: 1999}},
      c: {trackId: ID, band: null},
      d: {trackId: 'other', band: {lengthM: 5000}},
    },
    trackHistory: {[`${ID}__1`]: {trackId: ID, rev: 1}},
  });
  const be = adminBackend({db, FieldValue});
  assert.deepEqual(await be.readCatalog(ID), {
    track: null,
    boundaries: null,
    catalogRev: 0,
  });
  assert.deepEqual((await be.sessionLengths(ID)).sort(), [1999, 2001]);
  assert.equal(await be.sessionCount(ID), 3);
  assert.deepEqual([...(await be.readHistory(ID)).keys()], [1]);
});

test('add then undo through the Admin backend: one transaction each, history kept, the first add undone back to no map', async () => {
  const db = fakeDb({
    tracks: {[ID]: {id: ID, sim: 'lmu', surfaceNote: 'keep me'}},
  });
  const be = adminBackend({db, FieldValue});
  const plan = planAdd({
    trackId: ID,
    current: await be.readCatalog(ID),
    built,
    samples: [2000, 2001, 1999],
    blast: {sessions: 3},
  });
  assert.deepEqual(plan.refusals, []);
  await applyPlan(be, plan, {reason: 'first map', by: 'botkin', now: NOW});
  assert.equal(db.transactions, 1);
  const track = db.data.tracks.get(ID);
  assert.equal(track.catalogRev, 1);
  assert.equal(track.surfaceNote, 'keep me');
  assert.equal(track.corners.length, 2);
  assert.ok(db.data.trackBoundaries.has(ID));
  assert.equal(db.data.trackHistory.size, 1);

  const undo = planUndo({
    trackId: ID,
    current: await be.readCatalog(ID),
    history: await be.readHistory(ID),
    toRev: 0,
    blast: {sessions: 3},
  });
  assert.deepEqual(undo.refusals, []);
  await applyPlan(be, undo, {reason: 'wrong session', by: 'botkin', now: NOW});
  const after = db.data.tracks.get(ID);
  assert.equal(after.catalogRev, 2);
  assert.equal(after.corners, undefined, 'the map fields are removed');
  assert.equal(after.surfaceNote, 'keep me');
  assert.equal(db.data.trackBoundaries.has(ID), false);
  assert.equal(db.data.trackHistory.size, 2, 'history grows, never rewritten');
});

test('a plan made before another change is stale and nothing is written; so is one applied twice', async () => {
  const db = fakeDb();
  const be = adminBackend({db, FieldValue});
  const plan = planAdd({
    trackId: ID,
    current: await be.readCatalog(ID),
    built,
    samples: [],
    blast: {sessions: 0},
  });
  await applyPlan(be, plan, {reason: 'r', by: 'botkin', now: NOW});
  const before = JSON.stringify([...db.data.tracks]);
  await assert.rejects(
    () => applyPlan(be, plan, {reason: 'again', by: 'botkin', now: NOW}),
    PlanRefused,
  );
  assert.equal(JSON.stringify([...db.data.tracks]), before);
  assert.equal(db.data.trackHistory.size, 1);
});

test('a document Firestore would refuse is stopped before the transaction starts', async () => {
  const db = fakeDb();
  const be = adminBackend({db, FieldValue});
  const bad = {...built, map: {...MAP, lengthM: NaN}};
  const plan = planAdd({
    trackId: ID,
    current: await be.readCatalog(ID),
    built: bad,
    samples: [],
    blast: {sessions: 0},
  });
  plan.refusals.length = 0; // force it to the backend
  await assert.rejects(
    () => applyPlan(be, plan, {reason: 'r', by: 'botkin', now: NOW}),
    /not storable/,
  );
  assert.equal(db.transactions, 0);
  assert.equal(db.data.tracks.size, 0);
});

test('regenerateCatalogFile is run after a commit when given', async () => {
  let ran = 0;
  const db = fakeDb();
  const be = adminBackend({
    db,
    FieldValue,
    regenerateCatalogFile: async () => {
      ran++;
    },
  });
  const plan = planAdd({
    trackId: ID,
    current: await be.readCatalog(ID),
    built,
    samples: [],
    blast: {sessions: 0},
  });
  const out = await applyPlan(be, plan, {reason: 'r', by: 'botkin', now: NOW});
  assert.equal(ran, 1);
  assert.equal(out.regenerated, true);
});
