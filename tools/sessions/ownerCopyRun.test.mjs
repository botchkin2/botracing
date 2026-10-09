import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {test} from 'node:test';
import {LEGACY_OWNER} from './ownerCopy.mjs';
import {copyOwner, mapLimit, verifyCopy} from './ownerCopyRun.mjs';
import {memoryBackend, ownerData, snapshot} from './ownerCopyFixture.mjs';

const FROM = LEGACY_OWNER;
const TO = 'LwTNOO0lF7QnEx847fvEGr4EKRF3';

function setup() {
  const src = ownerData(FROM);
  const backend = memoryBackend(src);
  return {src, backend};
}

const keysOf = map => [...map.keys()].sort();
const run = (backend, extra = {}) =>
  copyOwner(backend, {from: FROM, to: TO, ...extra});

// What sync.mjs would have written for the new owner from the same recordings.
const natural = ownerData(TO);

test('a dry run reads everything, writes nothing, and reports counts, warnings and throughput', async () => {
  const {backend} = setup();
  const before = snapshot(backend);
  const r = await run(backend);
  assert.deepEqual(r.problems, []);
  assert.equal(backend.writes, 0);
  assert.deepEqual(keysOf(backend.docs), keysOf(before.docs));
  assert.deepEqual(keysOf(backend.files), keysOf(before.files));
  assert.deepEqual(
    {
      sessions: r.counts.sessions,
      recordings: r.counts.recordings,
      laps: r.counts.laps,
      docs: r.counts.docs,
    },
    {sessions: 2, recordings: 4, laps: 12, docs: 12 + 4 + 2},
  );
  assert.ok(r.counts.files > 0 && r.counts.bytes > 0);
  // The only thing to say: the shared track data names these sessions by old id.
  assert.equal(r.warnings.length, 1);
  assert.match(
    r.warnings[0],
    /names 2 of these sessions in the layout boundaries and 2 in the surface files by their OLD ids/,
  );
  // The dry run prints how fast it went, so the apply can be estimated.
  for (const k of [
    'planSeconds',
    'sessionsPerSecond',
    'filesPerSecond',
    'megabytes',
  ])
    assert.ok(r.throughput[k] > 0, k);
  assert.equal(r.applied, null);
  assert.equal(Object.keys(r.idMap.sessions).length, 2);
  assert.equal(Object.keys(r.idMap.laps).length, 12);
});

test("apply copies faithfully: the ids are the uploader's, verify finds nothing, the originals are untouched", async () => {
  const {backend} = setup();
  const before = snapshot(backend);
  const r = await run(backend, {apply: true});
  assert.deepEqual(r.problems, []);
  assert.ok(r.applied.docs > 0 && r.applied.files > 0);
  for (const [path, doc] of before.docs)
    assert.deepEqual(backend.docs.get(path), doc, path);
  for (const [path, f] of before.files) {
    assert.ok(backend.files.get(path).bytes.equals(f.bytes), path);
    assert.deepEqual(backend.files.get(path).meta, f.meta, path);
  }
  for (const coll of ['recordings', 'laps', 'sessions']) {
    const want = [...natural.docs.keys()]
      .filter(k => k.startsWith(`${coll}/`))
      .sort();
    const got = [...backend.docs.keys()]
      .filter(
        k => k.startsWith(`${coll}/`) && backend.docs.get(k).ownerId === TO,
      )
      .sort();
    assert.deepEqual(
      got,
      want,
      `${coll} ids are the ones a sync derives for the new owner`,
    );
  }
  assert.deepEqual(await verifyCopy(backend, {from: FROM, to: TO}), []);
});

test('a second run copies nothing, and does not even look at the files of a session already copied', async () => {
  const {backend} = setup();
  await run(backend, {apply: true});
  const writes = backend.writes;
  const stats = backend.reads.stats;
  const fileReads = backend.reads.fileReads;
  const again = await run(backend, {apply: true});
  assert.equal(backend.writes, writes, 'no write on a rerun');
  assert.equal(
    again.applied.skipped,
    2,
    'both sessions skipped by their updatedAt',
  );
  assert.equal(again.applied.sessions, 0);
  assert.equal(again.counts.skippedUnchanged, 2);
  // Only the track warning's reads: no stat of a trace or archive, no slice file.
  assert.ok(
    backend.reads.stats - stats <= 2,
    `stat calls on a rerun: ${backend.reads.stats - stats}`,
  );
  assert.ok(
    backend.reads.fileReads - fileReads <= 2,
    'only the shared surface file is read',
  );
  // The id map is complete even though nothing was planned.
  assert.equal(Object.keys(again.idMap.laps).length, 12);
});

test('a session that changed since it was copied is copied again; the others are skipped (the delta pass)', async () => {
  const {src, backend} = setup();
  await run(backend, {apply: true});
  const [path, session] = [...src.docs].find(
    ([k]) => k.startsWith('sessions/') && backend.docs.get(k).ownerId === FROM,
  );
  // The uploader synced one more lap into this session after the first copy.
  const rid = session.recordingIds[0];
  const lapId = `${rid}-004`;
  const lap = {
    ...[...src.docs.values()].find(d => d.id === `${rid}-001`),
    id: lapId,
    lapNumber: 4,
  };
  src.docs.set(`laps/${lapId}`, lap);
  src.files.set(
    lap.trace.path.replace('-001', '-004'),
    src.files.get(lap.trace.path),
  );
  lap.trace = {...lap.trace, path: lap.trace.path.replace('-001', '-004')};
  session.lapTable = [...session.lapTable, {id: lapId, lapNumber: 4}];
  session.updatedAt = '2026-09-30T00:00:00.000Z';

  const again = await run(backend, {apply: true});
  assert.deepEqual(again.problems, []);
  assert.equal(again.applied.sessions, 1, 'only the changed session');
  assert.equal(again.applied.skipped, 1);
  assert.ok(
    [...backend.docs.keys()].some(
      k =>
        k.startsWith('laps/') &&
        backend.docs.get(k).ownerId === TO &&
        backend.docs.get(k).lapNumber === 4,
    ),
  );
  assert.deepEqual(await verifyCopy(backend, {from: FROM, to: TO}), []);
});

test('--full checks every file again, even in a session that is already copied', async () => {
  const {backend} = setup();
  await run(backend, {apply: true});
  const stats = backend.reads.stats;
  // A trace of the copy is damaged; the delta pass would not notice.
  const bad = [...backend.files.keys()].find(p =>
    p.startsWith(`traces/${TO}/`),
  );
  backend.files.get(bad).bytes = Buffer.from('damaged');
  await run(backend, {apply: true});
  assert.equal(
    backend.files.get(bad).bytes.toString(),
    'damaged',
    'a delta pass leaves it',
  );
  const full = await run(backend, {apply: true, full: true});
  assert.ok(backend.reads.stats - stats > 10, 'full looked at the files');
  assert.equal(full.applied.sessions, 2);
  assert.notEqual(
    backend.files.get(bad).bytes.toString(),
    'damaged',
    'full put the right bytes back',
  );
  assert.deepEqual(await verifyCopy(backend, {from: FROM, to: TO}), []);
});

test('a run cut short at any point leaves nothing that points at something missing, and the rerun finishes the same copy', async () => {
  const clean = await (async () => {
    const {backend} = setup();
    await run(backend, {apply: true});
    return {writes: backend.writes, state: snapshot(backend)};
  })();
  for (const cut of [
    1,
    3,
    8,
    15,
    30,
    Math.floor(clean.writes / 2),
    clean.writes - 3,
    clean.writes - 1,
  ]) {
    const {backend} = setup();
    backend.failAfter(cut);
    await assert.rejects(run(backend, {apply: true}), /interrupted/);
    for (const [path, s] of backend.docs) {
      if (!path.startsWith('sessions/') || s.ownerId !== TO) continue;
      for (const id of s.recordingIds)
        assert.ok(
          backend.docs.has(`recordings/${id}`),
          `cut ${cut}: ${path} names a missing recording`,
        );
      for (const row of s.lapTable)
        assert.ok(
          backend.docs.has(`laps/${row.id}`),
          `cut ${cut}: ${path} names a missing lap`,
        );
      for (const p of [
        s.band?.path,
        s.field?.path,
        `${s.slices.prefix}/c1.json.gz`,
      ])
        assert.ok(
          backend.files.has(p),
          `cut ${cut}: ${path} names a missing file ${p}`,
        );
    }
    for (const [path, d] of backend.docs) {
      if (path.startsWith('laps/') && d.ownerId === TO)
        assert.ok(
          backend.files.has(d.trace.path),
          `cut ${cut}: ${path} names a missing trace`,
        );
    }
    backend.noLimit();
    await run(backend, {apply: true});
    assert.deepEqual(keysOf(backend.docs), keysOf(clean.state.docs));
    assert.deepEqual(keysOf(backend.files), keysOf(clean.state.files));
    assert.deepEqual(
      await verifyCopy(backend, {from: FROM, to: TO}),
      [],
      `cut ${cut}`,
    );
  }
});

test('verify catches a corrupted copy: bytes, file metadata, a document, a missing lap, a corrupt slice file', async () => {
  const corrupt = async mutate => {
    const {backend} = setup();
    await run(backend, {apply: true});
    mutate(backend);
    return verifyCopy(backend, {from: FROM, to: TO});
  };
  const toTrace = b =>
    [...b.files.keys()].find(p => p.startsWith(`traces/${TO}/`));
  assert.ok(
    (
      await corrupt(
        b => (b.files.get(toTrace(b)).bytes = Buffer.from('corrupt')),
      )
    ).some(d => d.includes('bytes differ')),
  );
  assert.ok(
    (
      await corrupt(b => (b.files.get(toTrace(b)).meta.contentEncoding = null))
    ).some(d => d.includes('contentType/contentEncoding/cacheControl differ')),
  );
  assert.ok(
    (
      await corrupt(b => (b.files.get(toTrace(b)).meta.cacheControl = 'public'))
    ).some(d => d.includes('cacheControl differ')),
  );
  const lapPath = b =>
    [...b.docs.keys()].find(
      p => p.startsWith('laps/') && b.docs.get(p).ownerId === TO,
    );
  assert.ok(
    (await corrupt(b => (b.docs.get(lapPath(b)).lapTime = 1))).some(d =>
      d.includes('differs from'),
    ),
  );
  assert.ok(
    (await corrupt(b => b.docs.delete(lapPath(b)))).some(d =>
      d.includes('laps: 12 originals, 11 copies'),
    ),
  );
  assert.ok(
    (
      await corrupt(b => {
        const p = [...b.files.keys()].find(k => k.startsWith(`slices/${TO}/`));
        b.files.get(p).bytes = Buffer.from('{}');
      })
    ).some(d => d.includes('not valid gzip')),
  );
});

test('an id the uploader would not derive stops the run before anything is written', async () => {
  const {src, backend} = setup();
  const rec = [...src.docs].find(([k]) => k.startsWith('recordings/'))[1];
  rec.source = 'renamed.duckdb';
  const r = await run(backend, {apply: true});
  assert.ok(r.problems.some(p => p.includes('the uploader would derive')));
  assert.equal(r.applied, null);
  assert.equal(backend.writes, 0);
});

test('an old id in a field nobody listed stops the run; the word in a title does not', async () => {
  const {src, backend} = setup();
  const [, session] = [...src.docs].find(([k]) => k.startsWith('sessions/'));
  session.title = 'Botkin Cup'; // fine
  session.surprise = {ref: session.id}; // not fine: an unlisted field holding an old id
  const r = await run(backend, {apply: true});
  assert.ok(
    r.problems.some(
      p => p.includes(`old id ${session.id}`) && p.includes('surprise'),
    ),
    r.problems.join('\n'),
  );
  assert.ok(!r.problems.some(p => p.includes('Botkin Cup')));
  assert.equal(
    r.applied,
    null,
    'nothing is applied when a pass found a problem',
  );
  assert.equal(backend.writes, 0);
});

test('a reference to ANOTHER session of the owner is caught too (the residual scan knows every old id)', async () => {
  const {src, backend} = setup();
  const sessions = [...src.docs]
    .filter(([k]) => k.startsWith('sessions/'))
    .map(([, v]) => v);
  sessions[0].surprise = {other: sessions[1].id};
  const r = await run(backend);
  assert.ok(
    r.problems.some(p => p.includes(`old id ${sessions[1].id}`)),
    r.problems.join('\n'),
  );
});

test('a lap with no trace file is copied with a warning, and counted', async () => {
  const {src, backend} = setup();
  const lap = [...src.docs].find(([k]) => k.startsWith('laps/'))[1];
  src.files.delete(lap.trace.path);
  const r = await run(backend, {apply: true});
  assert.deepEqual(r.problems, []);
  assert.equal(r.counts.missingFiles, 1);
  assert.ok(r.warnings.some(w => w.includes(lap.trace.path)));
});

test('--limit looks at the first sessions only', async () => {
  const {backend} = setup();
  const r = await run(backend, {limit: 1});
  assert.equal(r.counts.sessions, 1);
  assert.equal(Object.keys(r.idMap.sessions).length, 1);
});

test('tracks are shared app data: nothing is copied for them and what is there is left exactly as it was', async () => {
  const {backend} = setup();
  const before = snapshot(backend);
  await run(backend, {apply: true});
  assert.ok(
    [...backend.docs.keys()].every(k => !k.startsWith('users/')),
    'no users/ document was written',
  );
  assert.ok(
    [...backend.files.keys()].every(
      k => !k.startsWith(`surface/${TO}`) && !k.startsWith(`outline/${TO}`),
    ),
  );
  for (const path of [
    'tracks/lmu-road-atlanta',
    'trackBoundaries/lmu-road-atlanta',
  ]) {
    assert.deepEqual(backend.docs.get(path), before.docs.get(path), path);
  }
  for (const path of [
    'surface/lmu-road-atlanta/v1.json.gz',
    'outline/lmu-road-atlanta.json',
  ]) {
    assert.ok(
      backend.files.get(path).bytes.equals(before.files.get(path).bytes),
      path,
    );
  }
  // The surface file still names the old ids, as promised in the warning.
  const surface = JSON.parse(
    gunzipSync(
      backend.files.get('surface/lmu-road-atlanta/v1.json.gz').bytes,
    ).toString(),
  );
  assert.equal(surface.sessions.length, 2);
});

test('work is bounded: no more than the limit runs at once, and the order of results is kept', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([...Array(40).keys()], 5, async n => {
    running++;
    peak = Math.max(peak, running);
    await new Promise(r => setTimeout(r, 2));
    running--;
    return n * 2;
  });
  assert.equal(peak, 5);
  assert.deepEqual(
    out,
    [...Array(40).keys()].map(n => n * 2),
  );
  assert.deepEqual(await mapLimit([], 5, async n => n), []);
});

test('a run holds one session at a time: it never lists every lap of the owner', async () => {
  const {backend} = setup();
  await run(backend, {apply: true});
  // Laps are asked for session by session (never as one list of the owner).
  const src = readFileSync(
    new URL('./ownerCopyRun.mjs', import.meta.url),
    'utf8',
  );
  assert.ok(
    !/iterDocs\(\s*'laps'/.test(src) && !/listDocs/.test(src),
    'no owner-wide list of laps or recordings',
  );
  assert.ok(
    backend.reads.bySession >= 4,
    'laps and recordings were read per session',
  );
});

test('nothing can be deleted: the backend has no delete, and the copy code never asks for one', () => {
  const {backend} = setup();
  assert.deepEqual(
    Object.keys(backend).filter(k => /delete|remove|clear/i.test(k)),
    [],
  );
  for (const file of [
    'ownerCopyRun.mjs',
    'ownerCopy.mjs',
    'ownerCopyAdmin.mjs',
  ]) {
    const code = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(
      !/\.(delete|deleteFile|remove|rm|unlink)\s*\(/.test(code),
      `${file} calls a delete`,
    );
  }
});
