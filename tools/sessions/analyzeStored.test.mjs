// Run: node --test tools/sessions/analyzeStored.test.mjs
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {analyzeStored, archiveCandidates} from './analyzeStored.mjs';

test('an archive is looked for under its own path, then under the owner key', () => {
  assert.deepEqual(
    archiveCandidates('archive/lmu/s/r/samples.parquet', 'botkin'),
    [
      'archive/lmu/s/r/samples.parquet',
      'archive/botkin/lmu/s/r/samples.parquet',
    ],
  );
  assert.deepEqual(
    archiveCandidates('archive/botkin/lmu/s/r/samples.parquet', 'botkin'),
    ['archive/botkin/lmu/s/r/samples.parquet'],
  );
});

function storeOf({session, recordings, files}) {
  const docs = new Map([[`sessions/${session.id}`, session]]);
  for (const r of recordings) docs.set(`recordings/${r.id}`, r);
  const written = [];
  return {
    written,
    docs,
    getDoc: async (coll, id) => docs.get(`${coll}/${id}`) ?? null,
    getFile: async dest => files.get(dest) ?? null,
    writeDocs: async ops => {
      for (const op of ops) {
        written.push(`${op.coll}/${op.id}`);
        if (op.op === 'set') docs.set(`${op.coll}/${op.id}`, op.data);
      }
    },
    sessionLapIds: async () => [],
    fileMd5: async () => null,
    putFile: async () => {},
    deleteFile: async () => {},
    listFiles: async () => [],
  };
}

const session = {
  id: 's1',
  ownerId: 'botkin',
  trackId: null,
  recordingIds: ['r1'],
  series: 'GT3 Sprint',
  eventId: 'e9',
  sessionType: 'Race',
};
const recording = {
  id: 'r1',
  sim: 'lmu',
  sessionType: 'Race',
  // An old doc: the old path, the file under the owner's key.
  archive: {
    samples: 'archive/lmu/s1/r1/samples.parquet',
    events: 'archive/lmu/s1/r1/events.parquet',
  },
};

function engineOut() {
  return {
    session: {
      id: 's1',
      ownerId: 'botkin',
      sim: 'lmu',
      sessionType: 'Race',
      race: null,
      field: null,
      slices: null,
      fuel: null,
      result: null,
    },
    laps: [],
    lapWindows: [],
    band: null,
    fieldText: null,
    slices: null,
    traces: [],
    track: {id: 'never-written'},
    boundaries: {trackId: 'never-written'},
    damageMissing: true,
  };
}

test('a stored session is analysed from its archive with the stored inputs, and no track data is written', async () => {
  const files = new Map([
    ['archive/botkin/lmu/s1/r1/samples.parquet', Buffer.from('S')],
    ['archive/botkin/lmu/s1/r1/events.parquet', Buffer.from('E')],
  ]);
  const backend = storeOf({session, recordings: [recording], files});
  let input;
  const workDir = mkdtempSync(join(tmpdir(), 'analyzeStored-'));
  await analyzeStored({
    backend,
    sessionId: 's1',
    owner: 'botkin',
    workDir,
    analyze: i => ((input = i), engineOut()),
  });
  assert.equal(readFileSync(input.recordings[0].samplesPath, 'utf8'), 'S');
  assert.equal(readFileSync(input.recordings[0].eventsPath, 'utf8'), 'E');
  assert.deepEqual(input.event, {series: 'GT3 Sprint', eventId: 'e9'});
  assert.equal(input.catalogOnly, true);
  assert.equal(input.damage, null);
  assert.equal(input.fieldFor([]).field, null);
  assert.ok(!backend.written.some(w => /^(tracks|trackBoundaries)\//.test(w)));
  assert.ok(backend.written.includes('sessions/s1'));
});

test('a fence that throws before the write leaves the session unwritten (the lease, analyzeCore.ts)', async () => {
  const files = new Map([
    ['archive/botkin/lmu/s1/r1/samples.parquet', Buffer.from('S')],
    ['archive/botkin/lmu/s1/r1/events.parquet', Buffer.from('E')],
  ]);
  const backend = storeOf({session, recordings: [recording], files});
  await assert.rejects(
    analyzeStored({
      backend,
      sessionId: 's1',
      owner: 'botkin',
      workDir: mkdtempSync(join(tmpdir(), 'aS-')),
      analyze: engineOut,
      beforeWrite: async () => {
        throw Object.assign(new Error('lease lost'), {status: 409});
      },
    }),
    /lease lost/,
  );
  assert.equal(backend.written.length, 0);
});

test("another owner's session reads as not found", async () => {
  const backend = storeOf({session, recordings: [recording], files: new Map()});
  await assert.rejects(
    analyzeStored({
      backend,
      sessionId: 's1',
      owner: 'someone',
      workDir: tmpdir(),
      analyze: engineOut,
    }),
    e => e.status === 404,
  );
});

test('a missing archive is a 409, not a half analysis', async () => {
  const backend = storeOf({session, recordings: [recording], files: new Map()});
  await assert.rejects(
    analyzeStored({
      backend,
      sessionId: 's1',
      owner: 'botkin',
      workDir: mkdtempSync(join(tmpdir(), 'aS-')),
      analyze: engineOut,
    }),
    e => e.status === 409 && /archive missing/.test(e.message),
  );
  assert.equal(backend.written.length, 0);
});

test('a live recording stored in parts is downloaded part by part and read back through one glob', async () => {
  const live = {
    ...recording,
    archive: {
      parts: [0, 1, 2].map(i => ({
        samples: `archive/lmu/s1/r1/samples.00${i}.parquet`,
        events: `archive/lmu/s1/r1/events.00${i}.parquet`,
      })),
    },
  };
  const files = new Map();
  for (const i of [0, 1, 2]) {
    files.set(
      `archive/botkin/lmu/s1/r1/samples.00${i}.parquet`,
      Buffer.from(`S${i}`),
    );
    files.set(
      `archive/botkin/lmu/s1/r1/events.00${i}.parquet`,
      Buffer.from(`E${i}`),
    );
  }
  const backend = storeOf({session, recordings: [live], files});
  let input;
  const workDir = mkdtempSync(join(tmpdir(), 'analyzeStored-parts-'));
  await analyzeStored({
    backend,
    sessionId: 's1',
    owner: 'botkin',
    workDir,
    analyze: i => ((input = i), engineOut()),
  });
  const {samplesPath, eventsPath} = input.recordings[0];
  assert.match(samplesPath, /r1\.samples\.\*\.parquet$/);
  assert.match(eventsPath, /r1\.events\.\*\.parquet$/);
  for (const i of [0, 1, 2]) {
    assert.equal(
      readFileSync(join(workDir, `r1.samples.00${i}.parquet`), 'utf8'),
      `S${i}`,
    );
    assert.equal(
      readFileSync(join(workDir, `r1.events.00${i}.parquet`), 'utf8'),
      `E${i}`,
    );
  }
});

test("the game's stored results input reaches the analysis, and none is none", async () => {
  const {gzipSync} = await import('node:zlib');
  const input = {
    v: 1,
    strikes: [
      {et: 1390.7, points: 0.25, outcome: 'warning', ruling: 'Warning'},
    ],
    unplaced: 1,
    coveredFrom: 7.1,
    coveredTo: 2800.8,
  };
  const base = new Map([
    ['archive/botkin/lmu/s1/r1/samples.parquet', Buffer.from('S')],
    ['archive/botkin/lmu/s1/r1/events.parquet', Buffer.from('E')],
  ]);
  const run = async files => {
    let seen;
    await analyzeStored({
      backend: storeOf({session, recordings: [recording], files}),
      sessionId: 's1',
      owner: 'botkin',
      workDir: mkdtempSync(join(tmpdir(), 'analyzeStored-')),
      analyze: i => ((seen = i), engineOut()),
    });
    return seen.results;
  };
  const files = new Map(base);
  files.set(
    'inputs/botkin/s1/results.json.gz',
    gzipSync(Buffer.from(JSON.stringify(input))),
  );
  assert.deepEqual(await run(files), {
    strikes: input.strikes,
    unplaced: 1,
    coveredFrom: 7.1,
    coveredTo: 2800.8,
  });
  assert.equal(await run(base), null);
});

test('the stored capture extract carries online/offline to the analysis; no extract is unknown, never offline', async () => {
  const {gzipSync} = await import('node:zlib');
  const base = new Map([
    ['archive/botkin/lmu/s1/r1/samples.parquet', Buffer.from('S')],
    ['archive/botkin/lmu/s1/r1/events.parquet', Buffer.from('E')],
  ]);
  const run = async files => {
    let seen;
    await analyzeStored({
      backend: storeOf({session, recordings: [recording], files}),
      sessionId: 's1',
      owner: 'botkin',
      workDir: mkdtempSync(join(tmpdir(), 'analyzeStored-')),
      analyze: i => ((seen = i), engineOut()),
    });
    return seen.online;
  };
  const withExtract = online => {
    const files = new Map(base);
    files.set(
      'inputs/botkin/s1/capture.json.gz',
      gzipSync(
        Buffer.from(
          JSON.stringify({v: 1, damage: null, raceLength: null, online}),
        ),
      ),
    );
    return files;
  };
  assert.equal(await run(withExtract(false)), false);
  assert.equal(await run(withExtract(true)), true);
  assert.equal(await run(base), null);
});
