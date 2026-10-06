// Planning, applying and verifying the copy of one owner's data to another
// (pit wall thread 2 #140 to #147), over a backend. The pure rules are in
// ownerCopy.mjs.
//
// The backend has no delete: the copy never removes anything, and there is no
// way to ask it to.
//
//   listDocs(coll, ownerId)  -> [{id, data}]   recordings, sessions, laps
//   getDoc(path)             -> data | null    'tracks/x', 'users/<uid>/tracks/x'
//   setDoc(path, data)
//   statFile(path)           -> null | {size, md5, contentType, contentEncoding, cacheControl}
//   readFile(path)           -> {bytes, meta}  as stored (not decompressed)
//   writeFile(path, bytes, meta)
//   copyFile(from, to)       server-side, keeps the metadata
//
// Order of writes: files, then laps and recordings, then session documents
// last. A crash leaves harmless files or documents that
// nothing points at, which the next run writes again or ignores; it never
// leaves a session that points at something missing.
import {createHash} from 'node:crypto';
import {deepStrictEqual} from 'node:assert';
import {gunzipSync, gzipSync} from 'node:zlib';
import {checkDoc} from './docShape.mjs';
import {
  invert,
  makeMaps,
  mapLap,
  mapPath,
  mapRecording,
  mapSession,
  mapSliceText,
  residual,
  sliceHash,
} from './ownerCopy.mjs';

const md5 = bytes => createHash('md5').update(bytes).digest('base64');
const sameDoc = (a, b) => {
  try {
    deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
};
const sameMeta = (a, b) =>
  a.contentType === b.contentType &&
  (a.contentEncoding ?? null) === (b.contentEncoding ?? null) &&
  (a.cacheControl ?? null) === (b.cacheControl ?? null);
const gz = text => gzipSync(Buffer.from(text, 'utf8'), {level: 9});
const textOf = bytes => gunzipSync(bytes).toString('utf8');
// The text of a gzipped file, or null when it is not gzip (a corrupt file is a
// finding to report, not a crash).
const textOrNull = bytes => {
  try {
    return textOf(bytes);
  } catch {
    return null;
  }
};

/**
 * Everything the copy would write, or the reasons it cannot be done.
 * Reads only. Returns {problems, warnings, plan, maps, counts}.
 */
export async function planCopy(backend, {from, to}) {
  const [recs, sess, laps] = await Promise.all(
    ['recordings', 'sessions', 'laps'].map(c => backend.listDocs(c, from)),
  );
  const docs = {
    recordings: recs.map(x => x.data),
    sessions: sess.map(x => x.data),
    laps: laps.map(x => x.data),
  };
  const problems = [];
  const warnings = [];
  const {maps: m, problems: idProblems} = makeMaps(from, to, {
    recordings: docs.recordings,
    sessions: docs.sessions,
    laps: docs.laps,
  });
  problems.push(...idProblems);
  if (problems.length > 0)
    return {problems, warnings, plan: null, maps: m, counts: {}};

  const plan = {docs: [], copies: [], writes: []};
  const stat = async path => backend.statFile(path);

  // -- slice sets: rewritten, so the folder's content hash changes ----------
  for (const s of docs.sessions) {
    if (!s.slices) continue;
    const originals = [];
    const rewritten = [];
    const parts = [];
    for (const n of s.slices.corners ?? []) {
      const path = `${s.slices.prefix}/c${n}.json.gz`;
      const file = await backend.readFile(path);
      if (!file) {
        problems.push(`session ${s.id}: slice file ${path} is missing`);
        continue;
      }
      const text = textOrNull(file.bytes);
      if (text === null) {
        problems.push(`session ${s.id}: slice file ${path} is not valid gzip`);
        continue;
      }
      originals.push(text);
      let next;
      try {
        next = mapSliceText(text, m);
      } catch (e) {
        problems.push(`session ${s.id}: ${path}: ${e.message}`);
        continue;
      }
      rewritten.push(next);
      parts.push({n, text: next, meta: file.meta});
    }
    if (rewritten.length !== (s.slices.corners ?? []).length) continue;
    if (sliceHash(originals) !== s.slices.hash) {
      problems.push(
        `session ${s.id}: the slice files do not hash to the stored ${s.slices.hash}, so they are not the set the session names`,
      );
      continue;
    }
    const newHash = sliceHash(rewritten);
    m.slice.set(s.id, {from: s.slices.hash, to: newHash});
    for (const part of parts) {
      plan.writes.push({
        path: [
          `slices`,
          to,
          m.ses.get(s.id),
          newHash,
          `c${part.n}.json.gz`,
        ].join('/'),
        bytes: gz(part.text),
        meta: part.meta,
        scan: JSON.parse(part.text),
      });
    }
  }
  if (problems.length > 0)
    return {problems, warnings, plan: null, maps: m, counts: {}};

  // -- documents ------------------------------------------------------------
  const newDocs = {
    recordings: docs.recordings.map(d => mapRecording(d, m)),
    laps: docs.laps.map(d => mapLap(d, m)),
    sessions: docs.sessions.map(d => mapSession(d, m)),
  };
  for (const d of newDocs.laps)
    plan.docs.push({path: `laps/${d.id}`, data: d, order: 1});
  for (const d of newDocs.recordings)
    plan.docs.push({path: `recordings/${d.id}`, data: d, order: 1});

  // -- shared track data: not copied, only read, to report ----------------------
  // Tracks, their corner boundaries and surface files are app data, not an
  // owner's (Botkin, thread 2 #149). But they remember which sessions were
  // folded into them by the OLD session id; a fold that runs later, on the
  // copies, would not know they are the same laps. Counted here so it is known.
  const trackIds = [
    ...new Set(docs.sessions.map(s => s.trackId).filter(Boolean)),
  ];
  const foldState = {boundaries: 0, surface: 0};
  for (const id of trackIds) {
    const b = await backend.getDoc(`trackBoundaries/${id}`);
    for (const sid of Object.keys(b?.sessions ?? {}))
      if (m.ses.has(sid)) foldState.boundaries++;
    const t = await backend.getDoc(`tracks/${id}`);
    if (t?.surface?.path) {
      const file = await backend.readFile(t.surface.path);
      const text =
        file &&
        (file.meta.contentEncoding === 'gzip'
          ? textOrNull(file.bytes)
          : file.bytes.toString('utf8'));
      try {
        for (const sid of JSON.parse(text ?? 'null')?.sessions ?? [])
          if (m.ses.has(sid)) foldState.surface++;
      } catch {
        // Not JSON: nothing to count.
      }
    }
  }
  if (foldState.boundaries + foldState.surface > 0)
    warnings.push(
      `shared track data names ${foldState.boundaries} of these sessions in the layout boundaries and ${foldState.surface} in the surface files by their OLD ids (left as they are); a later server-side fold must treat the copies as already folded (the id map from --map-out says which is which)`,
    );

  // -- byte copies: traces, bands, fields, archives -------------------------
  const wanted = [];
  for (const l of docs.laps) if (l.trace?.path) wanted.push(l.trace.path);
  for (const s of docs.sessions) {
    if (s.band?.path) wanted.push(s.band.path);
    if (s.field?.path) wanted.push(s.field.path);
  }
  for (const r of docs.recordings) {
    if (r.archive?.samples) wanted.push(r.archive.samples);
    if (r.archive?.events) wanted.push(r.archive.events);
  }
  let missingFiles = 0;
  for (const path of wanted) {
    if (!(await stat(path))) {
      missingFiles++;
      if (missingFiles <= 20)
        warnings.push(
          `file ${path} does not exist (its document is copied with the new path)`,
        );
      continue;
    }
    plan.copies.push({from: path, to: mapPath(path, m)});
  }
  if (missingFiles > 20)
    warnings.push(`... and ${missingFiles - 20} more missing files`);

  // Sessions last.
  for (const d of newDocs.sessions)
    plan.docs.push({path: `sessions/${d.id}`, data: d, order: 3});

  // -- checks on everything that would be written -----------------------------
  for (const d of plan.docs) {
    const left = residual(d.data, m, d.path).filter(
      x => !(d.lenient ?? []).some(id => x.includes(id)),
    );
    if (left.length)
      problems.push(...left.slice(0, 5).map(x => `${x} (would be written)`));
    try {
      checkDoc(d.path, d.data);
    } catch (e) {
      problems.push(`${d.path}: ${e.message}`);
    }
  }
  for (const w of plan.writes) {
    const left = residual(w.scan, m, w.path).filter(
      x => !(w.lenient ?? []).some(id => x.includes(id)),
    );
    if (left.length)
      problems.push(...left.slice(0, 5).map(x => `${x} (would be written)`));
  }

  const counts = {
    recordings: docs.recordings.length,
    sessions: docs.sessions.length,
    laps: docs.laps.length,
    foldStateRefs: foldState.boundaries + foldState.surface,
    docs: plan.docs.length,
    fileCopies: plan.copies.length,
    fileWrites: plan.writes.length,
    missingFiles,
  };
  // A plan with a problem is never handed out, so it cannot be applied.
  return {
    problems,
    warnings,
    plan: problems.length > 0 ? null : plan,
    maps: m,
    counts,
  };
}

/**
 * Writes the plan. Idempotent: a file already at its destination with the same
 * bytes and metadata, and a document already equal, are left alone. Returns
 * what was written and what was already there.
 */
export async function applyPlan(backend, plan, {log = () => {}} = {}) {
  const done = {files: 0, filesSkipped: 0, docs: 0, docsSkipped: 0};
  for (const c of plan.copies) {
    const src = await backend.statFile(c.from);
    const dst = await backend.statFile(c.to);
    if (dst && src && dst.md5 === src.md5 && sameMeta(dst, src)) {
      done.filesSkipped++;
      continue;
    }
    await backend.copyFile(c.from, c.to);
    const after = await backend.statFile(c.to);
    if (!after || after.md5 !== src.md5 || !sameMeta(after, src))
      throw new Error(
        `${c.to}: the copy does not match ${c.from} after writing`,
      );
    done.files++;
  }
  for (const w of plan.writes) {
    const want = md5(w.bytes);
    const dst = await backend.statFile(w.path);
    if (dst && dst.md5 === want && sameMeta(dst, w.meta)) {
      done.filesSkipped++;
      continue;
    }
    await backend.writeFile(w.path, w.bytes, w.meta);
    const after = await backend.statFile(w.path);
    if (!after || after.md5 !== want)
      throw new Error(`${w.path}: not what was written`);
    done.files++;
  }
  log(`files: ${done.files} written, ${done.filesSkipped} already there`);
  const ordered = [...plan.docs].sort((a, b) => a.order - b.order);
  for (const d of ordered) {
    const existing = await backend.getDoc(d.path);
    if (existing && sameDoc(existing, d.data)) {
      done.docsSkipped++;
      continue;
    }
    await backend.setDoc(d.path, d.data);
    done.docs++;
  }
  log(`documents: ${done.docs} written, ${done.docsSkipped} already there`);
  return done;
}

/**
 * Read-only: compares the copy with the original. Counts of documents per
 * collection, every document mapped back to the original's, every file's bytes
 * and metadata (slice sets by content), and the slice hash the sessions name.
 * Returns the list of differences; empty means the copy is faithful.
 */
export async function verifyCopy(backend, {from, to}) {
  const diffs = [];
  const read = async owner =>
    Object.fromEntries(
      await Promise.all(
        ['recordings', 'sessions', 'laps'].map(async c => [
          c,
          await backend.listDocs(c, owner),
        ]),
      ),
    );
  const old = await read(from);
  const fresh = await read(to);
  for (const c of ['recordings', 'sessions', 'laps']) {
    if (old[c].length !== fresh[c].length)
      diffs.push(`${c}: ${old[c].length} originals, ${fresh[c].length} copies`);
  }
  const {maps: m, problems} = makeMaps(from, to, {
    recordings: old.recordings.map(x => x.data),
    sessions: old.sessions.map(x => x.data),
    laps: old.laps.map(x => x.data),
  });
  if (problems.length) return [...diffs, ...problems];

  // Which session each copy is of, and the slice hashes on both sides, before
  // the inverse maps are built from them.
  const oldOf = new Map([...m.ses].map(([o, n]) => [n, o]));
  const oldSessions = new Map(old.sessions.map(x => [x.id, x.data]));
  for (const {data: s} of fresh.sessions) {
    const original = oldSessions.get(oldOf.get(s.id));
    if (s.slices && original?.slices)
      m.slice.set(original.id, {from: original.slices.hash, to: s.slices.hash});
  }
  const back = invert(m);

  // Slice sets: the new files, mapped back, are the old ones; the hash matches.
  for (const {data: s} of fresh.sessions) {
    if (!s.slices) continue;
    const original = oldSessions.get(oldOf.get(s.id));
    const texts = [];
    for (const n of s.slices.corners ?? []) {
      const file = await backend.readFile(`${s.slices.prefix}/c${n}.json.gz`);
      const before =
        original &&
        (await backend.readFile(`${original.slices.prefix}/c${n}.json.gz`));
      if (!file || !before) {
        diffs.push(`session ${s.id}: slice file c${n} missing on one side`);
        continue;
      }
      const now = textOrNull(file.bytes);
      const was = textOrNull(before.bytes);
      if (now === null || was === null) {
        diffs.push(
          `session ${s.id}: slice c${n} is not valid gzip on one side`,
        );
        continue;
      }
      texts.push(now);
      let rebuilt = null;
      try {
        rebuilt = mapSliceText(now, back);
      } catch (e) {
        diffs.push(`session ${s.id}: slice c${n}: ${e.message}`);
        continue;
      }
      if (rebuilt !== was)
        diffs.push(
          `session ${s.id}: slice c${n} mapped back is not the original`,
        );
      if (!sameMeta(file.meta, before.meta))
        diffs.push(`session ${s.id}: slice c${n} metadata differs`);
    }
    if (texts.length && sliceHash(texts) !== s.slices.hash)
      diffs.push(
        `session ${s.id}: slice files do not hash to ${s.slices.hash}`,
      );
  }
  // Documents mapped back.
  const origById = {
    recordings: new Map(old.recordings.map(x => [x.id, x.data])),
    laps: new Map(old.laps.map(x => [x.id, x.data])),
    sessions: new Map(old.sessions.map(x => [x.id, x.data])),
  };
  const mapBack = {
    recordings: d => mapRecording(d, back),
    laps: d => mapLap(d, back),
    sessions: d => mapSession(d, back),
  };
  for (const c of ['recordings', 'laps', 'sessions']) {
    for (const {data} of fresh[c]) {
      let restored;
      try {
        restored = mapBack[c](data);
      } catch (e) {
        diffs.push(`${c}/${data.id}: ${e.message}`);
        continue;
      }
      const orig = origById[c].get(restored.id);
      if (!orig) diffs.push(`${c}/${data.id}: has no original`);
      else if (!sameDoc(restored, orig))
        diffs.push(
          `${c}/${data.id}: differs from ${restored.id} beyond the owner and ids`,
        );
    }
  }
  // Files: every byte copy has the original's bytes and metadata.
  const pairs = [];
  for (const l of old.laps)
    if (l.data.trace?.path) pairs.push(l.data.trace.path);
  for (const s of old.sessions) {
    if (s.data.band?.path) pairs.push(s.data.band.path);
    if (s.data.field?.path) pairs.push(s.data.field.path);
  }
  for (const r of old.recordings) {
    if (r.data.archive?.samples) pairs.push(r.data.archive.samples);
    if (r.data.archive?.events) pairs.push(r.data.archive.events);
  }
  for (const path of pairs) {
    const a = await backend.statFile(path);
    if (!a) continue; // missing in the original too: reported by the plan
    const b = await backend.statFile(mapPath(path, m));
    if (!b) diffs.push(`${mapPath(path, m)}: missing`);
    else if (b.md5 !== a.md5)
      diffs.push(`${mapPath(path, m)}: bytes differ from ${path}`);
    else if (!sameMeta(a, b))
      diffs.push(
        `${mapPath(
          path,
          m,
        )}: contentType/contentEncoding/cacheControl differ from ${path}`,
      );
  }
  return diffs;
}
