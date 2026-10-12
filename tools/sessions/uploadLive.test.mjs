import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {createStore} from './store.mjs';
import {LIVE_STAMP} from './liveSession.mjs';
import {analysisStamp} from './versionKey.mjs';

// A bucket and a database in memory; `offline` makes every putFile fail.
function backend(docs = new Map()) {
  const files = new Map();
  const b = {
    docs,
    files,
    order: [],
    offline: false,
    getDoc: async (c, id) => docs.get(`${c}/${id}`) ?? null,
    writeDocs: async ops => {
      for (const op of ops) {
        const key = `${op.coll}/${op.id}`;
        docs.set(key, op.merge ? {...(docs.get(key) ?? {}), ...op.data} : op.data);
      }
    },
    fileMd5: async dest => files.get(dest) ?? null,
    putFile: async (dest, {localPath}) => {
      if (b.offline) throw new Error('offline');
      const {readFileSync} = await import('node:fs');
      files.set(dest, createHash('md5').update(readFileSync(localPath)).digest('base64'));
      b.order.push(dest);
    },
  };
  return b;
}

const dir = mkdtempSync(join(tmpdir(), 'uploadLive-'));
function lapsOut(n) {
  const files = [];
  for (let i = 0; i < n; i++) {
    const local = join(dir, `p${i}.parquet`);
    writeFileSync(local, `lap ${i}`);
    files.push({local, dest: `archive/lmu/s1/r1/samples.00${i}.parquet`});
  }
  return {
    session: {id: 's1', recordingIds: ['r1'], archiveParts: n, lapCount: n, analysis: LIVE_STAMP},
    recordings: [{id: 'r1', archive: {parts: files.map(f => ({samples: f.dest}))}}],
    files,
  };
}

test('each lap sends only its own part; the docs follow the parts', async () => {
  const b = backend();
  const store = createStore(b);
  assert.deepEqual(await store.uploadLive(lapsOut(1)), {sent: 1});
  assert.deepEqual(await store.uploadLive(lapsOut(2)), {sent: 1});
  assert.equal(b.docs.get('sessions/s1').lapCount, 2);
  assert.deepEqual(b.order, ['archive/lmu/s1/r1/samples.000.parquet', 'archive/lmu/s1/r1/samples.001.parquet']);
});

test('offline for a lap: nothing is written for it, and the next lap sends both parts in order', async () => {
  const b = backend();
  const store = createStore(b);
  await store.uploadLive(lapsOut(1));
  b.offline = true;
  await assert.rejects(store.uploadLive(lapsOut(2)));
  assert.equal(b.docs.get('sessions/s1').lapCount, 1);
  b.offline = false;
  assert.deepEqual(await store.uploadLive(lapsOut(3)), {sent: 2});
  assert.deepEqual(b.order.slice(1), ['archive/lmu/s1/r1/samples.001.parquet', 'archive/lmu/s1/r1/samples.002.parquet']);
  assert.equal(b.docs.get('sessions/s1').lapCount, 3);
});

test('a lap over a session the cloud analysed keeps its analysed fields and reads stale', async () => {
  const docs = new Map([['sessions/s1', {analysis: analysisStamp(17, {}), archiveParts: 1, recordingIds: ['r1'], consistency: {x: 1}}]]);
  const b = backend(docs);
  await createStore(b).uploadLive(lapsOut(2));
  const s = b.docs.get('sessions/s1');
  assert.deepEqual(s.consistency, {x: 1});
  assert.equal(s.analysis.v, 0);
  assert.equal(s.archiveParts, 2);
});

test('the same parts again over an analysed session change nothing', async () => {
  const docs = new Map([['sessions/s1', {analysis: analysisStamp(17, {}), archiveParts: 2, recordingIds: ['r1']}]]);
  const b = backend(docs);
  assert.deepEqual(await createStore(b).uploadLive(lapsOut(2)), {skipped: 'newer'});
  assert.equal(b.order.length, 0);
});

test('a lap that lands while the cloud analyses is not taken as analysed', async () => {
  // The tray stored 5 laps; the cloud analysed the 4 it read.
  const docs = new Map([['sessions/s1', {analysis: {v: 0, blocks: {}}, archiveParts: 5, recordingIds: ['r1']}]]);
  const b = backend(docs);
  const out = {
    session: {id: 's1', ownerId: 'o', recordingIds: ['r1'], archiveParts: 4, analysis: analysisStamp(17, {})},
    recordings: [],
    laps: [],
    traces: [],
    files: [],
    band: null,
    track: null,
    boundaries: null,
  };
  await createStore({...b, sessionLapIds: async () => [], deleteFile: async () => {}, listFiles: async () => []}).upload(out);
  const s = b.docs.get('sessions/s1');
  assert.equal(s.archiveParts, 5);
  assert.equal(s.analysis.v, 0);
});
