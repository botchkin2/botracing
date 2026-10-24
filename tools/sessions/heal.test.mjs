import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  adoptLiveIds,
  claimCoveredSessions,
  confirmAdoptions,
  confirmClaims,
  recordingsToAdd,
  lapsToAdd,
  uncoveredPrefixS,
  coveredCopies,
  healPlan,
  settleSupersedes,
  tombstoneExpired,
  TOMBSTONE_DAYS,
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
    files: [
      {
        info: {
          sim: 'lmu',
          layout: 'Sil',
          recordedAt: at(1),
          startT: 0,
          endT: 590,
        },
      },
    ],
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

test('a usable live cover claims the game file and adds only the stretch it lacks', () => {
  const index = {
    'cap#0': {
      sessionId: 'LIVE',
      sim: 'lmu',
      layout: 'Sil',
      startMs: T0,
      endMs: T0 + 600_000,
    },
  };
  const session = {
    id: 'hash',
    files: [
      {
        info: {
          sim: 'lmu',
          layout: 'Sil',
          recordedAt: at(1),
          startT: 0,
          endT: 590,
        },
      },
    ],
  };
  assert.deepEqual(claimCoveredSessions([session], index, liveCover), [session]);
  assert.equal(session.id, 'LIVE');
  assert.equal(session.healLack, true);
  const stored = [{id: 'live-rec', recordedAt: at(1)}];
  const built = [
    {id: 'game-overlap', recordedAt: at(1)},
    {id: 'game-extra', recordedAt: at(1000)},
  ];
  assert.deepEqual(recordingsToAdd(stored, built).map(r => r.id), ['game-extra']);
  // The game file starts before the recorder and then covers the same stretch.
  const early = [{id: 'game-early', recordedAt: at(0), durationSec: 1054, startT: 0}];
  const live = [{id: 'live-rec', recordedAt: at(244), durationSec: 800, startT: 0}];
  assert.deepEqual(uncoveredPrefixS(live, early), {id: 'game-early', seconds: 244});
  const laps = [
    {id: 'game-early-000', recordingId: 'game-early', startT: 0, endT: 50},
    {id: 'game-early-001', recordingId: 'game-early', startT: 50, endT: 179},
    {id: 'game-early-002', recordingId: 'game-early', startT: 179, endT: 400},
  ];
  // Two laps finish before the recorder. The one that crosses into it is not added.
  assert.deepEqual(
    lapsToAdd(live, early, laps).map(l => l.id),
    ['game-early-000', 'game-early-001'],
  );
  // 52 s of the out lap, and the lap continues after the recorder starts: nothing new to add.
  const head = [{id: 'game-head', recordedAt: at(0), durationSec: 582, startT: 0}];
  const rec = [{id: 'live-rec', recordedAt: at(52), durationSec: 530, startT: 0}];
  assert.deepEqual(
    lapsToAdd(rec, head, [
      {id: 'game-head-000', recordingId: 'game-head', startT: 0, endT: 73},
    ]),
    [],
  );
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

test('a claim whose live session is gone from the store is undone, never re-created', async () => {
  const index = {
    'cap#0': {
      sessionId: 'LIVE',
      sim: 'lmu',
      layout: 'Sil',
      startMs: T0,
      endMs: T0 + 600_000,
    },
  };
  const mk = () => ({
    id: 'hash',
    files: [
      {
        info: {
          sim: 'lmu',
          layout: 'Sil',
          recordedAt: at(1),
          startT: 0,
          endT: 590,
        },
      },
    ],
  });
  const gone = mk();
  assert.deepEqual(
    await confirmClaims(claimCoveredSessions([gone], index, liveCover), async () => false),
    [],
  );
  assert.equal(gone.id, 'hash');
  assert.equal(gone.healLack, undefined);
  assert.equal(gone.hashId, undefined);
  const there = mk();
  const standing = await confirmClaims(
    claimCoveredSessions([there], index, liveCover),
    async id => id === 'LIVE',
  );
  assert.deepEqual(standing, [there]);
  assert.equal(there.id, 'LIVE');
  assert.equal(there.healLack, true);
});

test('a covered game file that adds no lap leaves the live session doc', async () => {
  const stored = {
    id: 'LIVE',
    ownerId: 'o',
    recordingIds: ['liveRec'],
    bestLapId: 'liveRec-001',
    lapCount: 2,
    consistency: {n: 2},
    plan: {stops: 1},
    traffic: {gapS: 0.4},
    analysis: {v: 4, blocks: {plan: 3}},
    field: {path: 'field/o/LIVE/live.json.gz', hash: 'livehash'},
  };
  const db = memoryStore(
    {
      'sessions/LIVE': structuredClone(stored),
      'recordings/liveRec': {
        id: 'liveRec',
        ownerId: 'o',
        recordedAt: at(52),
        durationSec: 530,
        startT: 0,
      },
      'laps/liveRec-001': {
        id: 'liveRec-001',
        ownerId: 'o',
        sessionId: 'LIVE',
        recordingId: 'liveRec',
      },
      'laps/liveRec-002': {
        id: 'liveRec-002',
        ownerId: 'o',
        sessionId: 'LIVE',
        recordingId: 'liveRec',
      },
    },
    {ownerKey: 'o'},
  );
  const deleted = [];
  await createStore({
    ...db,
    deleteFile: async path => {
      deleted.push(path);
    },
    listFiles: async () => [],
    getFile: async () => null,
  }).upload({
    healLack: true,
    session: {
      id: 'LIVE',
      ownerId: 'o',
      recordingIds: ['gameRec'],
      bestLapId: 'gameRec-002',
      lapCount: 3,
      consistency: {n: 3},
      plan: {stops: 0},
      traffic: {gapS: 1},
      analysis: {v: 9, blocks: {}},
      field: {
        path: 'field/o/LIVE/game.json.gz',
        hash: 'gamehash',
        cars: 30,
        durationS: 3700,
        mark: {kind: 'garbage'},
      },
    },
    recordings: [
      {
        id: 'gameRec',
        ownerId: 'o',
        recordedAt: at(0),
        durationSec: 582,
        startT: 0,
      },
    ],
    laps: [
      {
        id: 'gameRec-000',
        ownerId: 'o',
        sessionId: 'LIVE',
        recordingId: 'gameRec',
        startT: 0,
        endT: 73,
      },
    ],
    traces: [],
    files: [],
    band: null,
    track: null,
    boundaries: null,
    fieldText: '{}',
  });
  const doc = db.docs.get('sessions/LIVE');
  assert.deepEqual(doc.recordingIds, stored.recordingIds);
  const {recordingIds: _storedIds, ...storedRest} = stored;
  const {recordingIds: _docIds, ...docRest} = doc;
  assert.deepEqual(docRest, storedRest);
  assert.equal(db.docs.has('laps/gameRec-000'), false);
  assert.equal(db.docs.has('laps/liveRec-001'), true);
  assert.equal(db.docs.has('laps/liveRec-002'), true);
  assert.deepEqual(deleted, []);
});

test('laps a covered game file adds do not replace the live session header', async () => {
  const stored = {
    id: 'LIVE',
    ownerId: 'o',
    recordingIds: ['liveRec'],
    bestLapId: 'liveRec-001',
    lapCount: 2,
    analysis: {v: 4, blocks: {plan: 3}},
  };
  const db = memoryStore(
    {
      'sessions/LIVE': structuredClone(stored),
      'recordings/liveRec': {
        id: 'liveRec',
        ownerId: 'o',
        recordedAt: at(244),
        durationSec: 800,
        startT: 0,
      },
      'laps/liveRec-001': {
        id: 'liveRec-001',
        ownerId: 'o',
        sessionId: 'LIVE',
        recordingId: 'liveRec',
      },
    },
    {ownerKey: 'o'},
  );
  await createStore({
    ...db,
    deleteFile: async () => {},
    listFiles: async () => [],
    getFile: async () => null,
  }).upload({
    healLack: true,
    session: {
      id: 'LIVE',
      ownerId: 'o',
      recordingIds: ['gameRec'],
      bestLapId: 'gameRec-002',
      lapCount: 5,
      analysis: {v: 9, blocks: {}},
    },
    recordings: [
      {
        id: 'gameRec',
        ownerId: 'o',
        recordedAt: at(0),
        durationSec: 1054,
        startT: 0,
      },
    ],
    laps: [
      {
        id: 'gameRec-000',
        ownerId: 'o',
        sessionId: 'LIVE',
        recordingId: 'gameRec',
        startT: 0,
        endT: 50,
      },
      {
        id: 'gameRec-001',
        ownerId: 'o',
        sessionId: 'LIVE',
        recordingId: 'gameRec',
        startT: 50,
        endT: 179,
      },
    ],
    traces: [],
    files: [],
    band: null,
    track: null,
    boundaries: null,
  });
  const doc = db.docs.get('sessions/LIVE');
  assert.equal(doc.bestLapId, 'liveRec-001');
  assert.equal(doc.lapCount, 2);
  assert.deepEqual(doc.recordingIds, ['liveRec', 'gameRec']);
  assert.equal(doc.analysis.v, 0);
  assert.equal(db.docs.has('laps/gameRec-000'), true);
  assert.equal(db.docs.has('laps/gameRec-001'), true);
  assert.equal(db.docs.has('laps/liveRec-001'), true);
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
    files: [
      {
        info: {
          sim: 'lmu',
          layout: 'Sil',
          recordedAt: at(1),
          startT: 0,
          endT: 590,
        },
      },
    ],
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

test('the hand rebuild never tombstones a recording the healed session holds (same game file, same id)', async () => {
  // His 5 drives, 2026-10-18: each hand rebuild H and its healed session L
  // were built from the same game files, so they share recording ids.
  const db = memoryStore(
    {
      'sessions/H': {id: 'H', ownerId: 'o', recordingIds: ['r0', 'h1']},
      'sessions/L': {id: 'L', ownerId: 'o', recordingIds: ['r0']},
      'recordings/r0': {id: 'r0', ownerId: 'o', recordedAt: at(1)},
      'recordings/h1': {id: 'h1', ownerId: 'o', recordedAt: at(900)},
      'laps/l0': {id: 'l0', ownerId: 'o', sessionId: 'L', recordingId: 'r0'},
    },
    {ownerKey: 'o'},
  );
  const store = createStore({
    ...db,
    deleteFile: async () => {},
    listFiles: async () => [],
  });
  assert.deepEqual(await store.supersedeSession('H', 'L', 'now'), {
    recordings: 1,
    laps: 0,
  });
  assert.equal(
    db.docs.get('recordings/r0').supersededBy,
    undefined,
    'L keeps r0',
  );
  assert.equal(db.docs.get('recordings/h1').supersededBy, 'L');
  assert.equal(db.docs.get('laps/l0').supersededBy, undefined);
  assert.equal(db.docs.get('sessions/H').supersededBy, 'L');
});

test('a re-upload of the healed session clears a stray mark on its own recording (his 5 drives repair on their next sync)', async () => {
  const db = memoryStore(
    {
      'sessions/L': {id: 'L', ownerId: 'o', recordingIds: ['r0']},
      'recordings/r0': {
        id: 'r0',
        ownerId: 'o',
        recordedAt: at(1),
        supersededBy: 'L',
        supersededAt: 'then',
      },
    },
    {ownerKey: 'o'},
  );
  await createStore({
    ...db,
    deleteFile: async () => {},
    listFiles: async () => [],
  }).upload({
    session: {
      id: 'L',
      ownerId: 'o',
      recordingIds: ['r0'],
      analysis: {v: 1, blocks: {}},
    },
    recordings: [{id: 'r0', ownerId: 'o', recordedAt: at(1)}],
    laps: [],
    traces: [],
    files: [],
    band: null,
    track: null,
    boundaries: null,
  });
  assert.equal(db.docs.get('recordings/r0').supersededBy, undefined);
});

test('a sweep never takes a doc a live session lists, however old its mark', () => {
  const old = Date.parse('2026-10-01T00:00:00Z');
  const now = old + (TOMBSTONE_DAYS + 1) * 86_400_000;
  const mark = {supersededBy: 'L', supersededAt: new Date(old).toISOString()};
  assert.equal(
    tombstoneExpired({id: 'h1', ...mark}, now, new Set(['r0'])),
    true,
  );
  assert.equal(
    tombstoneExpired({id: 'r0', ...mark}, now, new Set(['r0'])),
    false,
  );
  assert.equal(
    tombstoneExpired({id: 'h1', ...mark}, old + 86_400_000, new Set()),
    false,
  );
});

test('an uploaded game-file session one live session covers whole is its copy; nothing else is', () => {
  const index = {
    'seb_10#0': {
      sessionId: '0dddbcb7',
      sim: 'lmu',
      layout: 'Seb',
      sessionType: 'Race',
      startMs: Date.parse('2026-10-21T00:40:23.279Z'),
      endMs: Date.parse('2026-10-21T01:42:17.293Z'),
    },
  };
  const file = (recordedAt, sessionType, durationS) => ({
    info: {
      sim: 'lmu',
      layout: 'Seb',
      sessionType,
      recordedAt,
      startT: 7,
      endT: 7 + durationS,
    },
  });
  const race = file('2026-10-21T00:39:17Z', 'Race', 3778);
  const quali = file('2026-10-21T00:28:01Z', 'Qualify', 740);
  const sessions = [
    {id: '53128f6f', files: [race]},
    {id: 'notUp', files: [race]},
    {id: 'q', files: [quali]},
    {id: 'mixed', files: [quali, race]},
    {id: '0dddbcb7', files: [race]},
  ];
  const uploaded = id => id !== 'notUp';
  assert.deepEqual(coveredCopies(sessions, index, liveCover, uploaded), {
    '53128f6f': '0dddbcb7',
  });
});
