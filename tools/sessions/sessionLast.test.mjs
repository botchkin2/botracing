// Run: node --test tools/sessions/sessionLast.test.mjs
// The session doc carries the analysis stamp, so store.mjs writes it last and
// alone: a failure before it must leave the old stamp (pit-wall thread 1 #4565).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createStore} from './store.mjs';
import {analysisStamp} from './versionKey.mjs';

const repair = {
  v: 3,
  kind: 'repair',
  detail: null,
  did: ['repair'],
  stationaryS: 61,
  evidence: [],
};
const unknown = {
  v: 3,
  kind: 'unknown',
  detail: null,
  did: [],
  stationaryS: 61,
  evidence: [],
};

function backendOver(docs, {failLaps = false} = {}) {
  const calls = [];
  return {
    calls,
    getDoc: async (coll, id) => docs.get(`${coll}/${id}`) ?? null,
    writeDocs: async ops => {
      calls.push(ops.map(op => op.coll));
      if (failLaps && ops.some(op => op.coll === 'laps'))
        throw new Error('laps refused');
      for (const op of ops)
        if (op.op === 'set') docs.set(`${op.coll}/${op.id}`, op.data);
    },
    sessionLapIds: async () => [],
    fileMd5: async () => null,
    putFile: async () => {},
    deleteFile: async () => {},
    listFiles: async () => [],
  };
}

function outFor({damageMissing = false, race = {minutes: 40}} = {}) {
  return {
    session: {
      id: 's1',
      ownerId: 'o',
      sim: 'lmu',
      sessionType: 'Race',
      race,
      field: null,
      slices: null,
      fuel: null,
      result: null,
      analysis: analysisStamp(17, {pitVisit: 3, raceLength: 1, tyres: 2}),
    },
    recordings: [],
    laps: [
      {
        id: 'l1',
        lapTime: 100,
        comparable: true,
        traffic: null,
        pitStop: {inPitS: 95, visit: unknown},
      },
    ],
    lapWindows: [],
    files: [],
    traces: [],
    band: null,
    slices: null,
    track: null,
    boundaries: null,
    damageMissing,
  };
}

test('the session doc is written last, in a call of its own', async () => {
  const backend = backendOver(new Map());
  await createStore(backend).upload(outFor());
  assert.deepEqual(backend.calls, [['laps'], ['sessions']]);
});

test('a failed lap write leaves the stored session and its stamp as they were', async () => {
  const old = {analysis: analysisStamp(16, {}), race: {minutes: 40}};
  const docs = new Map([['sessions/s1', old]]);
  await assert.rejects(
    createStore(backendOver(docs, {failLaps: true})).upload(outFor()),
    /laps refused/,
  );
  assert.equal(docs.get('sessions/s1'), old);
});

test('a fresh run stamps no kept blocks', async () => {
  const docs = new Map();
  await createStore(backendOver(docs)).upload(outFor());
  assert.deepEqual(docs.get('sessions/s1').analysis.kept, []);
});

test('blocks taken from the stored docs are named in the stamp', async () => {
  const docs = new Map([
    [
      'sessions/s1',
      {
        race: {minutes: 40},
        analysis: analysisStamp(17, {pitVisit: 2, raceLength: 1, tyres: 1}),
      },
    ],
    ['laps/l1', {pitStop: {inPitS: 95, visit: repair}}],
  ]);
  await createStore(backendOver(docs)).upload(
    outFor({damageMissing: true, race: null}),
  );
  const stamp = docs.get('sessions/s1').analysis;
  assert.deepEqual(stamp.kept, ['pitVisit', 'raceLength']);
  assert.equal(stamp.v, 17);
  // A consumer reading the kept blocks sees the rules they were made under.
  assert.equal(stamp.blocks.pitVisit, 2);
  assert.equal(stamp.blocks.raceLength, 1);
  assert.equal(stamp.blocks.tyres, 2);
});

test('a session stored under newer rules is left alone: nothing is written', async () => {
  const newer = {analysis: analysisStamp(18, {}), race: {minutes: 40}};
  const docs = new Map([['sessions/s1', newer]]);
  const backend = backendOver(docs);
  const r = await createStore(backend).upload(outFor());
  assert.deepEqual(r, {skipped: 'newer'});
  assert.deepEqual(backend.calls, []);
  assert.equal(docs.get('sessions/s1'), newer);
});

test('a new drive lands even over a session analysed under newer rules', async () => {
  const newer = {
    analysis: analysisStamp(18, {}),
    race: {minutes: 40},
    recordingIds: ['r1'],
  };
  const docs = new Map([['sessions/s1', newer]]);
  const backend = backendOver(docs);
  const out = outFor();
  out.session.recordingIds = ['r1', 'r2'];
  const r = await createStore(backend).upload(out);
  assert.notDeepEqual(r, {skipped: 'newer'});
  assert.deepEqual(docs.get('sessions/s1').recordingIds, ['r1', 'r2']);
  // Written under the older rules: it reads stale, and opening it runs it again.
  assert.equal(docs.get('sessions/s1').analysis.v, 17);
});

test('a practice uploaded one drive at a time ends as the same docs as all at once', async () => {
  const lapsOf = n =>
    Array.from({length: n}, (_, k) => ({
      id: `r${Math.floor(k / 2) + 1}-${String(k).padStart(3, '0')}`,
      lapTime: 90 + k,
      comparable: true,
      traffic: null,
      pitStop: null,
    }));
  const run = async steps => {
    const docs = new Map();
    const backend = backendOver(docs);
    backend.sessionLapIds = async id =>
      [...docs.keys()].filter(k => k.startsWith('laps/')).map(k => k.slice(5));
    for (const drives of steps) {
      const out = outFor();
      out.session.recordingIds = Array.from(
        {length: drives},
        (_, k) => `r${k + 1}`,
      );
      out.laps = lapsOf(drives * 2);
      out.recordings = out.session.recordingIds.map(id => ({id}));
      await createStore(backend).upload(out);
    }
    const strip = ([k, v]) => [k, {...v, updatedAt: undefined}];
    return [...docs].map(strip).sort(([a], [b]) => a.localeCompare(b));
  };
  assert.deepEqual(await run([1, 2, 3]), await run([3]));
});

test("a live session's next lap (one more archive part) lands over a newer stamp", async () => {
  const newer = {
    analysis: analysisStamp(18, {}),
    recordingIds: ['r1'],
    archiveParts: 4,
  };
  const docs = new Map([['sessions/s1', newer]]);
  const backend = backendOver(docs);
  const out = outFor();
  out.session.recordingIds = ['r1'];
  out.session.archiveParts = 5;
  const r = await createStore(backend).upload(out);
  assert.notDeepEqual(r, {skipped: 'newer'});
  assert.equal(docs.get('sessions/s1').archiveParts, 5);
});

test('the same parts again over a newer stamp is still skipped', async () => {
  const newer = {analysis: analysisStamp(18, {}), recordingIds: ['r1'], archiveParts: 5};
  const docs = new Map([['sessions/s1', newer]]);
  const backend = backendOver(docs);
  const out = outFor();
  out.session.recordingIds = ['r1'];
  out.session.archiveParts = 5;
  assert.deepEqual(await createStore(backend).upload(out), {skipped: 'newer'});
});

test("a lap uploaded while the analysis writes its laps keeps its stamp and part count", async () => {
  // Stored when the analysis read it: 5 parts, stamp t5.
  const docs = new Map([
    ['sessions/s1', {analysis: {v: 1}, recordingIds: ['r1'], archiveParts: 5, live: {updatedAt: '2026-10-14T01:13:54.425Z'}}],
  ]);
  const backend = backendOver(docs);
  // The live upload of lap 6 lands while the analysis writes its laps (the
  // first write of this upload), after the analysis read the session.
  const writeDocs = backend.writeDocs;
  let landed = false;
  backend.writeDocs = async (ops, w) => {
    await writeDocs(ops, w);
    if (!landed && ops.some(op => op.coll === 'laps')) {
      landed = true;
      docs.set('sessions/s1', {...docs.get('sessions/s1'), archiveParts: 6, live: {updatedAt: '2026-10-14T01:15:57.674Z'}});
    }
  };
  const out = outFor();
  out.session.recordingIds = ['r1'];
  out.session.archiveParts = 5;
  out.session.live = {updatedAt: '2026-10-14T01:13:54.425Z'};
  await createStore(backend).upload(out);
  assert.ok(landed, 'the lap landed mid-write');
  const s = docs.get('sessions/s1');
  assert.equal(s.live.updatedAt, '2026-10-14T01:15:57.674Z');
  assert.equal(s.archiveParts, 6);
  assert.equal(s.analysis.v, 0, 'left stale: lap 6 is not in this analysis');
});

test("analysis never rolls the live stamp back: a lap uploaded during the run keeps its stamp", async () => {
  // Stored: the live upload of lap 6 landed while analysis of 5 laps ran.
  const stored = {
    analysis: analysisStamp(1, {}),
    recordingIds: ['r1'],
    archiveParts: 6,
    live: {updatedAt: '2026-10-14T01:15:57.674Z'},
  };
  const docs = new Map([['sessions/s1', stored]]);
  const out = outFor();
  out.session.recordingIds = ['r1'];
  out.session.archiveParts = 5;
  // The stamp the analysis read at its start.
  out.session.live = {updatedAt: '2026-10-14T01:13:54.425Z'};
  await createStore(backendOver(docs)).upload(out);
  assert.equal(docs.get('sessions/s1').live.updatedAt, '2026-10-14T01:15:57.674Z');
});

test('a newer live stamp from the upload itself is written', async () => {
  const docs = new Map([['sessions/s1', {recordingIds: ['r1'], live: {updatedAt: '2026-10-14T01:13:54Z'}}]]);
  const out = outFor();
  out.session.recordingIds = ['r1'];
  out.session.live = {updatedAt: '2026-10-14T01:15:57Z'};
  await createStore(backendOver(docs)).upload(out);
  assert.equal(docs.get('sessions/s1').live.updatedAt, '2026-10-14T01:15:57Z');
});

// Pit-wall thread 103: finished live races stayed stale for good.
test('a healed drive analysed twice leaves its stamp current (the live counter no longer describes its recordings)', async () => {
  const T = '2026-10-15T02:20:48.845Z';
  // The stored doc after the heal: game-file recordings (no live parts), the
  // live count of 31 still on the session, stamp stale.
  const docs = new Map([
    ['sessions/s1', {analysis: {v: 0}, recordingIds: ['r1'], archiveParts: 31, live: {updatedAt: T}, rebuilt: {at: 'x', replaced: 1, kept: 0}}],
  ]);
  const backend = backendOver(docs);
  for (let run = 0; run < 2; run++) {
    const out = outFor();
    out.session.recordingIds = ['r1'];
    // what analyzeStored hands over for a recording with no live parts: no
    // count, the stamp it read at its start
    out.session.live = {updatedAt: T};
    await createStore(backend).upload(out);
    const s = docs.get('sessions/s1');
    assert.equal(s.analysis.v, 17, `run ${run + 1}: the stamp stays current`);
    assert.equal(s.archiveParts, undefined, 'the drifted count is gone');
  }
});

test('a lap that lands during the analysis still leaves it stale (the live stamp moved)', async () => {
  const docs = new Map([
    ['sessions/s1', {analysis: {v: 1}, recordingIds: ['r1'], archiveParts: 29, live: {updatedAt: '2026-10-21T01:42:33.000Z'}}],
  ]);
  const backend = backendOver(docs);
  const writeDocs = backend.writeDocs;
  backend.writeDocs = async (ops, w) => {
    await writeDocs(ops, w);
    if (ops.some(op => op.coll === 'laps'))
      docs.set('sessions/s1', {...docs.get('sessions/s1'), archiveParts: 30, live: {updatedAt: '2026-10-21T01:46:52.307Z'}});
  };
  const out = outFor();
  out.session.recordingIds = ['r1'];
  out.session.archiveParts = 29;
  out.session.live = {updatedAt: '2026-10-21T01:42:33.000Z'};
  await createStore(backend).upload(out);
  const s = docs.get('sessions/s1');
  assert.equal(s.archiveParts, 30);
  assert.equal(s.analysis.v, 0);
});

test('an analysis of stored recordings writes no recording at all (a part or an event the tray wrote meanwhile stays)', async () => {
  const backend = backendOver(new Map());
  const writes = [];
  const writeDocs = backend.writeDocs;
  backend.writeDocs = async (ops, w) => {
    writes.push(...ops);
    await writeDocs(ops, w);
  };
  const out = outFor();
  out.recordings = [{id: 'r1', ownerId: 'o', sessionId: 's1', archive: {parts: [{samples: 'a', events: 'b'}]}, track: 'T'}];
  out.session.recordingIds = ['r1'];
  out.recordingsAreStored = true;
  await createStore(backend).upload(out);
  assert.equal(writes.some(op => op.coll === 'recordings'), false);
  assert.ok(writes.some(op => op.coll === 'sessions'));
});
