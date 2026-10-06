import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {LEGACY_OWNER} from './ownerCopy.mjs';
import {applyPlan, planCopy, verifyCopy} from './ownerCopyRun.mjs';
import {memoryBackend, ownerData, snapshot} from './ownerCopyFixture.mjs';

const FROM = LEGACY_OWNER;
const TO = 'LwTNOO0lF7QnEx847fvEGr4EKRF3';

function setup() {
  const src = ownerData(FROM);
  const backend = memoryBackend(src);
  return {src, backend};
}

const same = (a, b) => assert.deepEqual(a, b);
const keysOf = map => [...map.keys()].sort();

// What sync.mjs would have written for the new owner from the same recordings.
const natural = ownerData(TO);

test('a dry run reads everything, writes nothing, and counts what it would do', async () => {
  const {backend} = setup();
  const before = snapshot(backend);
  const {problems, warnings, plan, counts} = await planCopy(backend, {
    from: FROM,
    to: TO,
  });
  assert.deepEqual(problems, []);
  // The only thing to say: the shared track data names these sessions by old id.
  assert.equal(warnings.length, 1);
  assert.match(
    warnings[0],
    /names 2 of these sessions in the layout boundaries and 2 in the surface files by their OLD ids/,
  );
  assert.equal(backend.writes, 0);
  same(keysOf(backend.docs), keysOf(before.docs));
  same(keysOf(backend.files), keysOf(before.files));
  assert.deepEqual(
    {
      recordings: counts.recordings,
      sessions: counts.sessions,
      laps: counts.laps,
      foldStateRefs: counts.foldStateRefs,
    },
    {recordings: 4, sessions: 2, laps: 12, foldStateRefs: 4},
  );
  // 12 laps + 4 recordings + 2 sessions. No track document.
  assert.equal(plan.docs.length, 12 + 4 + 2);
  assert.ok(counts.fileCopies > 0 && counts.fileWrites > 0);
});

test("apply copies faithfully: the new ids are the uploader's, verify finds nothing, the originals are untouched", async () => {
  const {backend} = setup();
  const before = snapshot(backend);
  const {plan, problems} = await planCopy(backend, {from: FROM, to: TO});
  assert.deepEqual(problems, []);
  const done = await applyPlan(backend, plan);
  assert.ok(done.docs > 0 && done.files > 0);

  // Every original document and file is still there, unchanged.
  for (const [path, doc] of before.docs)
    assert.deepEqual(backend.docs.get(path), doc, path);
  for (const [path, f] of before.files) {
    assert.ok(backend.files.get(path).bytes.equals(f.bytes), path);
    assert.deepEqual(backend.files.get(path).meta, f.meta, path);
  }
  // The copies are the documents a sync would write for the new owner.
  for (const path of ['recordings', 'laps', 'sessions']) {
    const want = [...natural.docs.keys()]
      .filter(k => k.startsWith(`${path}/`))
      .sort();
    const got = [...backend.docs.keys()]
      .filter(
        k => k.startsWith(`${path}/`) && backend.docs.get(k).ownerId === TO,
      )
      .sort();
    assert.deepEqual(
      got,
      want,
      `${path} ids are the ones a sync derives for the new owner`,
    );
  }
  assert.deepEqual(await verifyCopy(backend, {from: FROM, to: TO}), []);
});

test('a second run writes nothing', async () => {
  const {backend} = setup();
  const {plan} = await planCopy(backend, {from: FROM, to: TO});
  await applyPlan(backend, plan);
  const writes = backend.writes;
  const again = await planCopy(backend, {from: FROM, to: TO});
  const done = await applyPlan(backend, again.plan);
  assert.equal(backend.writes, writes, 'no write on a rerun');
  assert.equal(done.files + done.docs, 0);
  assert.ok(done.filesSkipped > 0 && done.docsSkipped > 0);
});

test('a run cut short at any point leaves nothing that points at something missing, and the rerun finishes the same copy', async () => {
  const total = (() => {
    const {backend} = setup();
    return planCopy(backend, {from: FROM, to: TO}).then(async r => {
      await applyPlan(backend, r.plan);
      return {writes: backend.writes, state: snapshot(backend)};
    });
  })();
  const {writes, state: clean} = await total;
  for (const cut of [
    1,
    3,
    8,
    15,
    30,
    Math.floor(writes / 2),
    writes - 3,
    writes - 1,
  ]) {
    const {backend} = setup();
    const {plan} = await planCopy(backend, {from: FROM, to: TO});
    backend.failAfter(cut);
    await assert.rejects(applyPlan(backend, plan), /interrupted/);
    // Any session document of the new owner has all it names.
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
      if (!path.startsWith('laps/') || d.ownerId !== TO) continue;
      assert.ok(
        backend.files.has(d.trace.path),
        `cut ${cut}: ${path} names a missing trace`,
      );
    }
    backend.noLimit();
    const again = await planCopy(backend, {from: FROM, to: TO});
    await applyPlan(backend, again.plan);
    same(keysOf(backend.docs), keysOf(clean.docs));
    same(keysOf(backend.files), keysOf(clean.files));
    assert.deepEqual(
      await verifyCopy(backend, {from: FROM, to: TO}),
      [],
      `cut ${cut}`,
    );
  }
});

test('verify catches a corrupted copy: bytes, file metadata, a document, a missing lap', async () => {
  const run = async mutate => {
    const {backend} = setup();
    const {plan} = await planCopy(backend, {from: FROM, to: TO});
    await applyPlan(backend, plan);
    mutate(backend);
    return verifyCopy(backend, {from: FROM, to: TO});
  };
  const toTrace = b =>
    [...b.files.keys()].find(p => p.startsWith(`traces/${TO}/`));
  assert.ok(
    (
      await run(b => (b.files.get(toTrace(b)).bytes = Buffer.from('corrupt')))
    ).some(d => d.includes('bytes differ')),
  );
  assert.ok(
    (
      await run(b => (b.files.get(toTrace(b)).meta.contentEncoding = null))
    ).some(d => d.includes('contentType/contentEncoding/cacheControl differ')),
  );
  assert.ok(
    (
      await run(b => (b.files.get(toTrace(b)).meta.cacheControl = 'public'))
    ).some(d => d.includes('cacheControl differ')),
  );
  const lapPath = b =>
    [...b.docs.keys()].find(
      p => p.startsWith('laps/') && b.docs.get(p).ownerId === TO,
    );
  assert.ok(
    (await run(b => (b.docs.get(lapPath(b)).lapTime = 1))).some(d =>
      d.includes('differs from'),
    ),
  );
  assert.ok(
    (await run(b => b.docs.delete(lapPath(b)))).some(d =>
      d.includes('laps: 12 originals, 11 copies'),
    ),
  );
  assert.ok(
    (
      await run(b => {
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
  const {problems, plan} = await planCopy(backend, {from: FROM, to: TO});
  assert.equal(plan, null);
  assert.ok(problems.some(p => p.includes('the uploader would derive')));
  assert.equal(backend.writes, 0);
});

test('an old id in a field nobody listed stops the run; the word in a title does not', async () => {
  const {src, backend} = setup();
  const [, session] = [...src.docs].find(([k]) => k.startsWith('sessions/'));
  session.title = 'Botkin Cup'; // fine
  session.surprise = {ref: session.id}; // not fine: an unlisted field holding an old id
  const {problems, plan} = await planCopy(backend, {from: FROM, to: TO});
  assert.equal(plan, null);
  assert.ok(
    problems.some(
      p => p.includes(`old id ${session.id}`) && p.includes('surprise'),
    ),
    problems.join('\n'),
  );
  assert.ok(!problems.some(p => p.includes('Botkin Cup')));
});

test('a lap with no trace file is copied with a warning, and counted', async () => {
  const {src, backend} = setup();
  const lap = [...src.docs].find(([k]) => k.startsWith('laps/'))[1];
  src.files.delete(lap.trace.path);
  const {problems, warnings, counts, plan} = await planCopy(backend, {
    from: FROM,
    to: TO,
  });
  assert.deepEqual(problems, []);
  assert.equal(counts.missingFiles, 1);
  assert.ok(warnings.some(w => w.includes(lap.trace.path)));
  await applyPlan(backend, plan);
  const copy = [...backend.docs.values()].find(
    d =>
      d.ownerId === TO &&
      d.trackId &&
      d.trace &&
      d.lapNumber === lap.lapNumber &&
      d.id !== lap.id &&
      d.id.endsWith(lap.id.slice(16)),
  );
  assert.ok(copy && copy.trace.path.startsWith(`traces/${TO}/`));
});

test('tracks are shared app data: nothing is copied for them and what is there is left exactly as it was', async () => {
  const {backend} = setup();
  const before = snapshot(backend);
  const {plan} = await planCopy(backend, {from: FROM, to: TO});
  await applyPlan(backend, plan);
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
});

test('nothing can be deleted: the backend has no delete, and the copy code never asks for one', () => {
  const {backend} = setup();
  assert.deepEqual(
    Object.keys(backend).filter(k => /delete|remove|clear/i.test(k)),
    [],
  );
  for (const file of ['ownerCopyRun.mjs', 'ownerCopy.mjs']) {
    const code = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(
      !/\.(delete|deleteFile|remove|rm|unlink)\s*\(/.test(code),
      `${file} calls a delete`,
    );
  }
});
