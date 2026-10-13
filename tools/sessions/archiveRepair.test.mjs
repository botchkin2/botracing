import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {ARCHIVE_REPAIR, repairArchives} from './archiveRepair.mjs';

// Two uploaded sessions: s1's file was rounded by the old types, s2's was not;
// s3 was never uploaded from this PC.
function setup({sameBytes = false} = {}) {
  const calls = [];
  const store = {
    replaceArchiveFile: async dest => (calls.push(['put', dest]), !sameBytes),
    markStale: async (id, owner) => void calls.push(['stale', id, owner]),
  };
  const writeArchive = (path, _info, samples) => {
    writeFileSync(samples, path);
    return {rounded: path === 'a.ibt' ? ['tyres_wear_fl'] : []};
  };
  const sessions = [
    {id: 's1', files: [{id: 'r1', path: 'a.ibt', info: {}}]},
    {id: 's2', files: [{id: 'r2', path: 'b.ibt', info: {}}]},
    {id: 's3', files: [{id: 'r3', path: 'a.ibt', info: {}}]},
  ];
  const state = {sessions: {s1: {}, s2: {}}};
  return {calls, store, writeArchive, sessions, state};
}

test('only a rounded file goes up, at the archive path, and its session reads stale', async () => {
  const {calls, store, writeArchive, sessions, state} = setup();
  const dir = mkdtempSync(join(tmpdir(), 'repair-'));
  let saves = 0;
  const n = await repairArchives({
    sessions,
    state,
    store,
    writeArchive,
    dir,
    save: () => saves++,
    sim: 'iracing',
    ownerId: 'o',
  });
  assert.equal(n, 1);
  assert.deepEqual(calls, [
    ['put', 'archive/iracing/s1/r1/samples.parquet'],
    ['stale', 's1', 'o'],
  ]);
  assert.deepEqual(state.archiveRepair, {
    s1: ARCHIVE_REPAIR,
    s2: ARCHIVE_REPAIR,
  });
  assert.equal(saves, 2);
  // Once only: a second run sends nothing.
  calls.length = 0;
  assert.equal(
    await repairArchives({
      sessions,
      state,
      store,
      writeArchive,
      dir,
      save: () => {},
      sim: 'iracing',
      ownerId: 'o',
    }),
    0,
  );
  assert.deepEqual(calls, []);
});

test('a rounded file already in place (an earlier run stopped before the stale mark) still marks its session stale', async () => {
  const {calls, store, writeArchive, sessions, state} = setup({
    sameBytes: true,
  });
  const dir = mkdtempSync(join(tmpdir(), 'repair-'));
  const n = await repairArchives({
    sessions,
    state,
    store,
    writeArchive,
    dir,
    save: () => {},
    sim: 'iracing',
    ownerId: 'o',
  });
  assert.equal(n, 1);
  assert.deepEqual(calls, [['put', 'archive/iracing/s1/r1/samples.parquet'], ['stale', 's1', 'o']]);
});

test('a failed repair is logged and tried again next time; the other sessions go on', async () => {
  const {store, writeArchive, sessions, state} = setup();
  store.replaceArchiveFile = async () => {
    throw new Error('offline');
  };
  const lines = [];
  const dir = mkdtempSync(join(tmpdir(), 'repair-'));
  const n = await repairArchives({
    sessions,
    state,
    store,
    writeArchive,
    dir,
    save: () => {},
    sim: 'iracing',
    ownerId: 'o',
    log: l => lines.push(l),
  });
  assert.equal(n, 0);
  assert.deepEqual(state.archiveRepair, {s2: ARCHIVE_REPAIR});
  assert.match(lines[0], /archive repair s1: offline/);
});

// The real adapter, not a mock: writeArchive's return is what the repair reads,
// and a dropped return was 26 of 26 failed repairs on 0.1.8 and 0.1.9 that the
// mocked tests above could not see (thread 1 #4974). A synthetic .ibt (no real
// telemetry, so it runs in CI): tyre wear whole for 26,000 rows, then 98.51,
// the case the CSV's guessed types rounded.
test('the real iRacing writeArchive feeds the repair: a rounded file goes up and its session reads stale', async () => {
  const {writeTestIbt} = await import('./testIbt.mjs');
  const iracing = await import('./iracing.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'repair-real-'));
  const n = 27000;
  const t = Array.from({length: n}, (_, i) => i / 60);
  const lapLen = 3600;
  const wear = Array.from({length: n}, (_, i) => (i < 26000 ? 99 : 98.51));
  const f = values => ({type: 'float', values});
  const path = join(dir, 'synthetic.ibt');
  writeTestIbt(path, {
    yaml: 'WeekendInfo:\n TrackName: synthetic\n TrackDisplayName: Synthetic\n TrackLength: 3.60 km\nSessionInfo:\n Sessions:\n - SessionNum: 0\n   SessionType: Practice\n',
    channels: {
      SessionTime: {type: 'double', values: t},
      Lap: {type: 'int', values: t.map((_, i) => 1 + Math.floor(i / lapLen))},
      LapDistPct: f(t.map((_, i) => (i % lapLen) / lapLen)),
      LapDist: f(t.map((_, i) => ((i % lapLen) / lapLen) * 3600)),
      Speed: f(t.map(() => 50)),
      Throttle: f(t.map(() => 1)),
      Brake: f(t.map(() => 0)),
      IsOnTrack: {type: 'bool', values: t.map(() => 1)},
      LFwearL: f(wear),
      RFwearL: f(wear),
      LRwearL: f(wear),
      RRwearL: f(wear),
    },
  });
  const info = iracing.describe(path);
  const calls = [];
  const store = {
    async replaceArchiveFile(dest) {
      calls.push(['put', dest]);
      return true;
    },
    async markStale(id, owner) {
      calls.push(['stale', id, owner]);
    },
  };
  const state = {sessions: {s1: {}}};
  const n2 = await repairArchives({
    sessions: [{id: 's1', files: [{id: 'r1', path, info}]}],
    state,
    store,
    writeArchive: iracing.writeArchive,
    dir: join(dir, 'work'),
    save: () => {},
    sim: 'iracing',
    ownerId: 'o',
    log: line => calls.push(['log', line]),
  });
  assert.deepEqual(calls, [
    ['put', 'archive/iracing/s1/r1/samples.parquet'],
    ['stale', 's1', 'o'],
  ]);
  assert.equal(n2, 1);
});
