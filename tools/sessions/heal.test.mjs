import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  adoptLiveIds,
  confirmAdoptions,
  healPlan,
  settleSupersedes,
  DEFECT,
} from './heal.mjs';
import {liveCover} from './liveSession.mjs';
import {createStore} from './store.mjs';
import {memoryStore} from '../golden/memoryStore.mjs';

const T0 = Date.parse('2026-10-15T00:35:00Z');
const at = s => new Date(T0 + s * 1000).toISOString();

test('a stored recording is replaced only when the build has one within 2 s; the unmatched one stays', () => {
  // bearing #5659 / 1edfb967: a live session of 2 stretches, a game file of 1.
  const plan = healPlan({
    stored: [
      {id: 'L0', ownerId: 'o', recordedAt: at(0)},
      {id: 'L1', ownerId: 'o', recordedAt: at(3000)},
    ],
    built: [{id: 'B0', ownerId: 'o', recordedAt: at(1.5)}],
    laps: [
      {id: 'l0', ownerId: 'o', recordingId: 'L0'},
      {id: 'l1', ownerId: 'o', recordingId: 'L1'},
    ],
    ownerId: 'o',
    nowIso: 'now',
    defect: DEFECT,
  });
  assert.deepEqual(plan.replaced, {L0: 'B0'});
  assert.deepEqual(plan.kept, ['L1']);
  assert.equal(plan.lapsSuperseded, 1);
  const byId = Object.fromEntries(
    plan.ops.map(o => [`${o.coll}/${o.id}`, o.data]),
  );
  assert.equal(byId['recordings/L0'].supersededBy, 'B0');
  assert.equal(byId['laps/l0'].supersededBy, 'B0');
  assert.equal(byId['laps/l1'], undefined);
  assert.deepEqual(byId['recordings/L1'], {ownerId: 'o', defects: [DEFECT]});
  // The upload API refuses a set, a merge too, that does not name its owner
  // (uploadCore.ts; his PC's 403 on 0.1.13).
  for (const o of plan.ops) assert.equal(o.data.ownerId, 'o', o.id);
});

test('2.5 s apart is not the same stretch; one build recording replaces one stored', () => {
  const plan = healPlan({
    stored: [
      {id: 'L0', ownerId: 'o', recordedAt: at(0)},
      {id: 'L1', ownerId: 'o', recordedAt: at(1)},
    ],
    built: [{id: 'B0', ownerId: 'o', recordedAt: at(0.5)}],
    laps: [],
    nowIso: 'now',
  });
  assert.deepEqual(plan.replaced, {L0: 'B0'});
  assert.deepEqual(plan.kept, ['L1']);
  assert.equal(
    plan.ops.length,
    1,
    'no defect named: the kept stretch is not marked',
  );
  const far = healPlan({
    stored: [{id: 'L0', ownerId: 'o', recordedAt: at(0)}],
    built: [{id: 'B0', ownerId: 'o', recordedAt: at(2.5)}],
    laps: [],
    nowIso: 'now',
  });
  assert.deepEqual(far.kept, ['L0']);
});

test('the game-file session takes the live id only for a defective capture, and only when unambiguous', () => {
  const full = {
    'cap#0': {
      sessionId: 'LIVE',
      sim: 'lmu',
      layout: 'Sil',
      startMs: T0,
      endMs: T0 + 600_000,
    },
  };
  const session = id => ({
    id,
    files: [{info: {sim: 'lmu', layout: 'Sil', recordedAt: at(1)}}],
  });
  const a = session('hash1');
  assert.deepEqual(adoptLiveIds([a], full, {}, liveCover), [a]);
  assert.equal(a.id, 'LIVE');
  assert.equal(a.healDefect, DEFECT);
  // A usable capture covers the file instead: no adoption.
  const b = session('hash2');
  assert.deepEqual(adoptLiveIds([b], full, full, liveCover), []);
  assert.equal(b.id, 'hash2');
  // Two game-file sessions claiming one live id: neither adopts.
  const c = session('c');
  const d = session('d');
  assert.deepEqual(adoptLiveIds([c, d], full, {}, liveCover), []);
});

test('the upload tombstones what it replaces, keeps the lone stretch and its laps, and hides both from the leftover cleanup', async () => {
  const db = memoryStore(
    {
      'sessions/S': {
        id: 'S',
        ownerId: 'o',
        recordingIds: ['L0', 'L1'],
        archiveParts: 4,
      },
      'recordings/L0': {id: 'L0', ownerId: 'o', recordedAt: at(0)},
      'recordings/L1': {id: 'L1', ownerId: 'o', recordedAt: at(3000)},
      'laps/l0': {id: 'l0', ownerId: 'o', sessionId: 'S', recordingId: 'L0'},
      'laps/l1': {id: 'l1', ownerId: 'o', sessionId: 'S', recordingId: 'L1'},
    },
    {ownerKey: 'o'},
  );
  const out = {
    session: {
      id: 'S',
      ownerId: 'o',
      recordingIds: ['B0'],
      analysis: {v: 1, blocks: {}},
    },
    recordings: [{id: 'B0', ownerId: 'o', recordedAt: at(1)}],
    laps: [{id: 'b0', ownerId: 'o', sessionId: 'S', recordingId: 'B0'}],
    traces: [],
    files: [],
    band: null,
    track: null,
    boundaries: null,
    healDefect: DEFECT,
  };
  const lines = [];
  await createStore({
    ...db,
    deleteFile: async () => {},
    listFiles: async () => [],
  }).upload(out, {log: l => lines.push(l)});
  assert.deepEqual(db.docs.get('sessions/S').recordingIds, ['B0', 'L1']);
  assert.equal(db.docs.get('recordings/L0').supersededBy, 'B0');
  assert.equal(db.docs.get('laps/l0').supersededBy, 'B0');
  assert.ok(db.docs.has('laps/l1'), 'the kept stretch keeps its laps');
  assert.equal(db.docs.get('laps/l1').supersededBy, undefined);
  assert.deepEqual(db.docs.get('recordings/L1').defects, [DEFECT]);
  assert.ok(db.docs.has('laps/b0'));
  assert.ok(
    lines.some(l => l.includes('heal: 1 recording(s) replaced (L0 -> B0)')),
    lines.join('\n'),
  );
  // A kept stretch needs the cloud to analyse it: the session reads stale, and says it was rebuilt.
  assert.equal(db.docs.get('sessions/S').analysis.v, 0);
  assert.deepEqual(
    {
      replaced: db.docs.get('sessions/S').rebuilt.replaced,
      kept: db.docs.get('sessions/S').rebuilt.kept,
    },
    {replaced: 1, kept: 1},
  );
  // A later upload (the cloud's analysis) does not delete the tombstone.
  await createStore({
    ...db,
    deleteFile: async () => {},
    listFiles: async () => [],
  }).upload({
    ...out,
    healDefect: null,
    session: {...out.session, recordingIds: ['B0', 'L1']},
  });
  assert.ok(
    db.docs.has('laps/l0'),
    'a tombstoned lap survives a later cleanup',
  );
});

test('an adoption whose live session is gone from the store is undone, never re-created', async () => {
  const full = {
    'cap#0': {
      sessionId: 'LIVE',
      sim: 'lmu',
      layout: 'Sil',
      startMs: T0,
      endMs: T0 + 600_000,
    },
  };
  const mk = () => ({
    id: 'hash1',
    files: [{info: {sim: 'lmu', layout: 'Sil', recordedAt: at(1)}}],
  });
  const gone = mk();
  const adopted = adoptLiveIds([gone], full, {}, liveCover);
  assert.deepEqual(await confirmAdoptions(adopted, async () => false), []);
  assert.equal(gone.id, 'hash1');
  assert.equal(gone.healDefect, undefined);
  const there = mk();
  const standing = await confirmAdoptions(
    adoptLiveIds([there], full, {}, liveCover),
    async id => id === 'LIVE',
  );
  assert.deepEqual(standing, [there]);
  assert.equal(there.id, 'LIVE');
});

test('the hand rebuild is tombstoned after the healed session is up, and nothing writes it again', async () => {
  const db = memoryStore(
    {
      'sessions/H': {
        id: 'H',
        ownerId: 'o',
        recordingIds: ['h0'],
        analysis: {v: 1, blocks: {}},
      },
      'recordings/h0': {id: 'h0', ownerId: 'o', recordedAt: at(1)},
      'laps/hl0': {id: 'hl0', ownerId: 'o', sessionId: 'H', recordingId: 'h0'},
    },
    {ownerKey: 'o'},
  );
  const store = createStore({
    ...db,
    deleteFile: async () => {},
    listFiles: async () => [],
  });
  const moved = await store.supersedeSession('H', 'L', 'now');
  assert.deepEqual(moved, {recordings: 1, laps: 1});
  for (const k of ['sessions/H', 'recordings/h0', 'laps/hl0'])
    assert.equal(db.docs.get(k).supersededBy, 'L', k);
  assert.equal(await store.supersedeSession('H', 'L', 'later'), null, 'once');
  // A sync that still holds the hash id does not write it back.
  const out = {
    session: {
      id: 'H',
      ownerId: 'o',
      recordingIds: ['h0'],
      analysis: {v: 1, blocks: {}},
    },
    recordings: [{id: 'h0'}],
    laps: [],
    traces: [],
    files: [],
    band: null,
    track: null,
    boundaries: null,
  };
  assert.deepEqual(await store.upload(out), {skipped: 'superseded'});
  assert.equal(db.docs.get('sessions/H').supersededBy, 'L');
});

test('a tombstone that fails after the healed upload stays pending and goes through on the next sync', async () => {
  const pending = {H1: 'L1', H2: 'L2'};
  let fail = true;
  const calls = [];
  const supersede = async (oldId, byId) => {
    calls.push(oldId);
    if (oldId === 'H1' && fail) throw new Error('network');
    return {recordings: 1, laps: 2};
  };
  const lines = [];
  await settleSupersedes(pending, supersede, l => lines.push(l));
  assert.deepEqual(pending, {H1: 'L1'}, 'only the failed one stays');
  assert.ok(lines.some(l => l.includes('not hidden yet')));
  fail = false;
  await settleSupersedes(pending, supersede, () => {});
  assert.deepEqual(pending, {});
  assert.deepEqual(calls, ['H1', 'H2', 'H1']);
});
