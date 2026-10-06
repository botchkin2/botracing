// Planning, applying and verifying the copy of one owner's data to another
// (pit wall thread 2 #140 to #154), over a backend. The pure rules are in
// ownerCopy.mjs.
//
// One session at a time. Only a session's own recordings, laps and files are
// in memory at once, never every lap of the owner: a session is read, checked,
// written, and let go. Within a session the file copies and document writes run
// with bounded concurrency.
//
// The backend has no delete: the copy never removes anything, and there is no
// way to ask it to.
//
//   iterDocs(coll, ownerId)       -> async iterable of {id, data}, paged
//   listIds(coll, ownerId)        -> [id]            ids only, no fields
//   countDocs(coll, ownerId)      -> number
//   listBySession(coll, sessionId, ownerId) -> [{id, data}]
//   getDoc(path)                  -> data | null
//   setDoc(path, data)
//   statFile(path)                -> null | {size, md5, contentType, contentEncoding, cacheControl}
//   readFile(path)                -> {bytes, meta}   as stored (not decompressed)
//   writeFile(path, bytes, meta)
//   copyFile(from, to)            server side, keeps the metadata
//
// Order within a session: files, then its laps and recordings, then its
// session document last. A crash leaves harmless files or documents that
// nothing points at, which the next run writes again or ignores; it never
// leaves a session that points at something missing.
//
// A rerun skips a whole session whose copy already exists with the same
// `updatedAt` and `analysisVersion` as the original (the copy carries the
// original's), without looking at its files: the final pass after the freeze
// costs the sessions that changed, not the whole owner. `full: true` checks
// every file instead.
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

export const DEFAULT_CONCURRENCY = {stat: 16, copy: 8, docs: 8};

/** fn over items, at most `limit` at a time; results in order. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++)
      results[i] = await fn(items[i], i);
  };
  await Promise.all(
    Array.from({length: Math.min(limit, items.length)}, worker),
  );
  return results;
}

/** Every old id (recordings and sessions) of the owner, ids only. */
async function oldIdsOf(backend, from) {
  const [recordings, sessions] = await Promise.all([
    backend.listIds('recordings', from),
    backend.listIds('sessions', from),
  ]);
  return new Set([...recordings, ...sessions]);
}

/**
 * One session's plan: the documents and files it would write, the problems and
 * warnings found. Reads only. `oldIds`: every old id of the owner, for the
 * residual scan.
 */
export async function planSession(
  backend,
  session,
  {from, to, oldIds, conc = DEFAULT_CONCURRENCY},
) {
  const problems = [];
  const warnings = [];
  const [recordings, laps] = await Promise.all([
    backend.listBySession('recordings', session.id, from),
    backend.listBySession('laps', session.id, from),
  ]);
  const docs = {
    recordings: recordings.map(x => x.data),
    laps: laps.map(x => x.data),
  };
  const {maps: m, problems: idProblems} = makeMaps(from, to, {
    recordings: docs.recordings,
    sessions: [session],
    laps: docs.laps,
  });
  m.oldIds = oldIds;
  problems.push(...idProblems);
  if (problems.length > 0)
    return {session, problems, warnings, plan: null, maps: m, stats: {}};

  const plan = {docs: [], copies: [], writes: []};

  // Slice set: rewritten, so the folder's content hash changes.
  if (session.slices) {
    const originals = [];
    const parts = [];
    for (const n of session.slices.corners ?? []) {
      const path = `${session.slices.prefix}/c${n}.json.gz`;
      const file = await backend.readFile(path);
      if (!file) {
        problems.push(`session ${session.id}: slice file ${path} is missing`);
        continue;
      }
      const text = textOrNull(file.bytes);
      if (text === null) {
        problems.push(
          `session ${session.id}: slice file ${path} is not valid gzip`,
        );
        continue;
      }
      let next;
      try {
        next = mapSliceText(text, m);
      } catch (e) {
        problems.push(`session ${session.id}: ${path}: ${e.message}`);
        continue;
      }
      originals.push(text);
      parts.push({n, text: next, meta: file.meta});
    }
    if (problems.length === 0) {
      if (sliceHash(originals) !== session.slices.hash) {
        problems.push(
          `session ${session.id}: the slice files do not hash to the stored ${session.slices.hash}, so they are not the set the session names`,
        );
      } else {
        const newHash = sliceHash(parts.map(p => p.text));
        m.slice.set(session.id, {from: session.slices.hash, to: newHash});
        for (const part of parts) {
          plan.writes.push({
            path: [
              'slices',
              to,
              m.ses.get(session.id),
              newHash,
              `c${part.n}.json.gz`,
            ].join('/'),
            bytes: gz(part.text),
            meta: part.meta,
            scan: JSON.parse(part.text),
          });
        }
      }
    }
  }
  if (problems.length > 0)
    return {session, problems, warnings, plan: null, maps: m, stats: {}};

  // Documents.
  const newLaps = docs.laps.map(d => mapLap(d, m));
  const newRecs = docs.recordings.map(d => mapRecording(d, m));
  const newSession = mapSession(session, m);
  for (const d of newLaps)
    plan.docs.push({path: `laps/${d.id}`, data: d, order: 1});
  for (const d of newRecs)
    plan.docs.push({path: `recordings/${d.id}`, data: d, order: 1});
  plan.docs.push({
    path: `sessions/${newSession.id}`,
    data: newSession,
    order: 3,
  });

  // Byte copies: traces, band, field, archive. Stat them concurrently.
  const wanted = [];
  for (const l of docs.laps) if (l.trace?.path) wanted.push(l.trace.path);
  if (session.band?.path) wanted.push(session.band.path);
  if (session.field?.path) wanted.push(session.field.path);
  for (const r of docs.recordings) {
    if (r.archive?.samples) wanted.push(r.archive.samples);
    if (r.archive?.events) wanted.push(r.archive.events);
  }
  const stats = await mapLimit(wanted, conc.stat, path =>
    backend.statFile(path),
  );
  let bytes = 0;
  let missingFiles = 0;
  wanted.forEach((path, i) => {
    if (!stats[i]) {
      missingFiles++;
      warnings.push(
        `file ${path} does not exist (its document is copied with the new path)`,
      );
      return;
    }
    bytes += stats[i].size;
    plan.copies.push({from: path, to: mapPath(path, m), size: stats[i].size});
  });

  // Checks on everything that would be written.
  for (const d of plan.docs) {
    const left = residual(d.data, m, d.path);
    if (left.length)
      problems.push(...left.slice(0, 5).map(x => `${x} (would be written)`));
    try {
      checkDoc(d.path, d.data);
    } catch (e) {
      problems.push(`${d.path}: ${e.message}`);
    }
  }
  for (const w of plan.writes) {
    const left = residual(w.scan, m, w.path);
    if (left.length)
      problems.push(...left.slice(0, 5).map(x => `${x} (would be written)`));
    bytes += w.bytes.length;
  }
  return {
    session,
    problems,
    warnings,
    plan: problems.length > 0 ? null : plan,
    maps: m,
    stats: {
      recordings: docs.recordings.length,
      laps: docs.laps.length,
      docs: plan.docs.length,
      files: plan.copies.length + plan.writes.length,
      bytes,
      missingFiles,
    },
  };
}

/** Writes one session's plan, with bounded concurrency. Idempotent. */
export async function applySession(
  backend,
  plan,
  {conc = DEFAULT_CONCURRENCY} = {},
) {
  const done = {files: 0, filesSkipped: 0, docs: 0, docsSkipped: 0, bytes: 0};
  await mapLimit(plan.copies, conc.copy, async c => {
    const [src, dst] = await Promise.all([
      backend.statFile(c.from),
      backend.statFile(c.to),
    ]);
    if (dst && src && dst.md5 === src.md5 && sameMeta(dst, src)) {
      done.filesSkipped++;
      return;
    }
    await backend.copyFile(c.from, c.to);
    const after = await backend.statFile(c.to);
    if (!after || after.md5 !== src.md5 || !sameMeta(after, src))
      throw new Error(
        `${c.to}: the copy does not match ${c.from} after writing`,
      );
    done.files++;
    done.bytes += src.size;
  });
  await mapLimit(plan.writes, conc.copy, async w => {
    const want = md5(w.bytes);
    const dst = await backend.statFile(w.path);
    if (dst && dst.md5 === want && sameMeta(dst, w.meta)) {
      done.filesSkipped++;
      return;
    }
    await backend.writeFile(w.path, w.bytes, w.meta);
    const after = await backend.statFile(w.path);
    if (!after || after.md5 !== want)
      throw new Error(`${w.path}: not what was written`);
    done.files++;
    done.bytes += w.bytes.length;
  });
  const writeDoc = async d => {
    const existing = await backend.getDoc(d.path);
    if (existing && sameDoc(existing, d.data)) {
      done.docsSkipped++;
      return;
    }
    await backend.setDoc(d.path, d.data);
    done.docs++;
  };
  // Laps and recordings together, then the session document last.
  await mapLimit(
    plan.docs.filter(d => d.order < 3),
    conc.docs,
    writeDoc,
  );
  for (const d of plan.docs.filter(d => d.order === 3)) await writeDoc(d);
  return done;
}

/** True when this session's copy is already there as it was when copied. */
async function unchanged(backend, session, newId) {
  if (!session.updatedAt) return false;
  const dest = await backend.getDoc(`sessions/${newId}`);
  return Boolean(
    dest &&
      dest.updatedAt === session.updatedAt &&
      dest.analysisVersion === session.analysisVersion,
  );
}

/**
 * What a session that is already copied needs in a plan pass: its ids, checked
 * the same way, and whether the copy is current. No lap documents, no file
 * stats, no slice files: the laps' ids come from the session's own lap table
 * (a lap id is "<recordingId>-<n>").
 */
async function cheapUnit(backend, session, {from, to, oldIds}) {
  const recordings = (
    await backend.listBySession('recordings', session.id, from)
  ).map(x => x.data);
  const laps = (session.lapTable ?? []).map(row => ({
    id: row.id,
    ownerId: from,
    sessionId: session.id,
    recordingId: row.id.slice(0, row.id.lastIndexOf('-')),
  }));
  const {maps, problems} = makeMaps(from, to, {
    recordings,
    sessions: [session],
    laps,
  });
  maps.oldIds = oldIds;
  const current =
    problems.length === 0 &&
    (await unchanged(backend, session, maps.ses.get(session.id)));
  return {
    maps,
    problems,
    current,
    recordings: recordings.length,
    laps: laps.length,
  };
}

/**
 * Plans (and with apply: copies) every session of `from`, one at a time.
 *   apply     false: reads only. true: a read-only pass over everything first,
 *             and only if it found no problem, the copy session by session.
 *   full      check every file even for a session already copied
 *   limit     only the first N sessions (a quick look at a big owner)
 *   progress  called with a line now and then
 * Returns {problems, warnings, counts, throughput, idMap, applied}.
 */
export async function copyOwner(
  backend,
  {
    from,
    to,
    apply = false,
    full = false,
    limit = Infinity,
    conc = DEFAULT_CONCURRENCY,
    progress = () => {},
    now = () => Date.now(),
  },
) {
  const started = now();
  const oldIds = await oldIdsOf(backend, from);
  const problems = [];
  const warnings = [];
  const idMap = {from, to, sessions: {}, recordings: {}, laps: {}};
  const counts = {
    sessions: 0,
    recordings: 0,
    laps: 0,
    docs: 0,
    files: 0,
    bytes: 0,
    missingFiles: 0,
    skippedUnchanged: 0,
  };
  const newIds = new Set();

  const eachSession = async fn => {
    let seen = 0;
    for await (const {data: session} of backend.iterDocs('sessions', from)) {
      if (seen++ >= limit) break;
      await fn(session);
    }
  };

  // Pass 1: read-only. Every session is planned and checked.
  let planned = 0;
  await eachSession(async session => {
    // A session whose copy is current is not planned again: ids only.
    const cheap =
      full || !session.updatedAt
        ? null
        : await cheapUnit(backend, session, {from, to, oldIds});
    if (cheap && cheap.current) {
      Object.assign(idMap.sessions, Object.fromEntries(cheap.maps.ses));
      Object.assign(idMap.recordings, Object.fromEntries(cheap.maps.rec));
      Object.assign(idMap.laps, Object.fromEntries(cheap.maps.lap));
      newIds.add(cheap.maps.ses.get(session.id));
      counts.sessions++;
      counts.recordings += cheap.recordings;
      counts.laps += cheap.laps;
      counts.skippedUnchanged++;
      planned++;
      return;
    }
    const unit = await planSession(backend, session, {from, to, oldIds, conc});
    problems.push(...unit.problems);
    warnings.push(...unit.warnings.slice(0, 5));
    if (unit.problems.length === 0) {
      const newSid = unit.maps.ses.get(session.id);
      if (newIds.has(newSid))
        problems.push(
          `session ${session.id}: its new id ${newSid} is already taken`,
        );
      newIds.add(newSid);
      Object.assign(idMap.sessions, Object.fromEntries(unit.maps.ses));
      Object.assign(idMap.recordings, Object.fromEntries(unit.maps.rec));
      Object.assign(idMap.laps, Object.fromEntries(unit.maps.lap));
      counts.sessions++;
      counts.recordings += unit.stats.recordings;
      counts.laps += unit.stats.laps;
      counts.docs += unit.stats.docs;
      counts.files += unit.stats.files;
      counts.bytes += unit.stats.bytes;
      counts.missingFiles += unit.stats.missingFiles;
    }
    planned++;
    if (planned % 25 === 0) progress(`planned ${planned} sessions`);
  });
  const seconds = Math.max((now() - started) / 1000, 0.001);
  const throughput = {
    planSeconds: seconds,
    sessionsPerSecond: counts.sessions / seconds,
    filesPerSecond: counts.files / seconds,
    megabytes: counts.bytes / 1048576,
  };

  // Where the shared track data names these sessions by their old ids: read
  // only, to say so (track data is not copied).
  warnings.push(...(await foldStateWarnings(backend, from, idMap)));

  const result = {problems, warnings, counts, throughput, idMap, applied: null};
  if (!apply || problems.length > 0) return result;

  // Pass 2: the copy.
  const applied = {
    sessions: 0,
    skipped: 0,
    files: 0,
    filesSkipped: 0,
    docs: 0,
    docsSkipped: 0,
    bytes: 0,
  };
  const copyStarted = now();
  await eachSession(async session => {
    const newSid = idMap.sessions[session.id];
    if (!full && (await unchanged(backend, session, newSid))) {
      applied.skipped++;
      return;
    }
    const unit = await planSession(backend, session, {from, to, oldIds, conc});
    if (unit.problems.length > 0) {
      problems.push(...unit.problems);
      return;
    }
    const done = await applySession(backend, unit.plan, {conc});
    applied.sessions++;
    for (const k of ['files', 'filesSkipped', 'docs', 'docsSkipped', 'bytes'])
      applied[k] += done[k];
    const handled = applied.sessions + applied.skipped;
    if (handled % 10 === 0) {
      const secs = Math.max((now() - copyStarted) / 1000, 0.001);
      progress(
        `copied ${handled} of ${counts.sessions} sessions, ${(
          applied.bytes / 1048576
        ).toFixed(1)} MB, ${(applied.bytes / 1048576 / secs).toFixed(1)} MB/s`,
      );
    }
  });
  const secs = Math.max((now() - copyStarted) / 1000, 0.001);
  result.applied = {
    ...applied,
    seconds: secs,
    megabytesPerSecond: applied.bytes / 1048576 / secs,
  };
  return result;
}

async function foldStateWarnings(backend, from, idMap) {
  // The distinct tracks the owner's sessions are on, from the session
  // documents again (paged), keeping only the ids.
  const trackIds = new Set();
  for await (const {data} of backend.iterDocs('sessions', from))
    if (data.trackId) trackIds.add(data.trackId);
  let boundaries = 0;
  let surface = 0;
  for (const id of trackIds) {
    const b = await backend.getDoc(`trackBoundaries/${id}`);
    for (const sid of Object.keys(b?.sessions ?? {}))
      if (idMap.sessions[sid]) boundaries++;
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
          if (idMap.sessions[sid]) surface++;
      } catch {
        // Not JSON: nothing to count.
      }
    }
  }
  return boundaries + surface === 0
    ? []
    : [
        `shared track data names ${boundaries} of these sessions in the layout boundaries and ${surface} in the surface files by their OLD ids (left as they are); a later server-side fold must treat the copies as already folded (the id map from --map-out says which is which)`,
      ];
}

/**
 * Read-only: compares the copy with the original, a session at a time.
 * Document counts per collection (counted by the database, not by reading),
 * and per session: every document mapped back to the original's, every file's
 * bytes and metadata, each slice set mapped back and its hash.
 * Returns the differences; empty means the copy is faithful.
 */
export async function verifyCopy(
  backend,
  {from, to, limit = Infinity, conc = DEFAULT_CONCURRENCY},
) {
  const diffs = [];
  for (const c of ['recordings', 'sessions', 'laps']) {
    const [a, b] = await Promise.all([
      backend.countDocs(c, from),
      backend.countDocs(c, to),
    ]);
    if (a !== b) diffs.push(`${c}: ${a} originals, ${b} copies`);
  }
  const oldIds = await oldIdsOf(backend, from);
  let seen = 0;
  for await (const {data: session} of backend.iterDocs('sessions', from)) {
    if (seen++ >= limit) break;
    const [recs, laps] = await Promise.all([
      backend.listBySession('recordings', session.id, from),
      backend.listBySession('laps', session.id, from),
    ]);
    const old = {
      recordings: recs.map(x => x.data),
      laps: laps.map(x => x.data),
    };
    const {maps: m, problems} = makeMaps(from, to, {
      recordings: old.recordings,
      sessions: [session],
      laps: old.laps,
    });
    if (problems.length) {
      diffs.push(...problems);
      continue;
    }
    m.oldIds = oldIds;
    const newSid = m.ses.get(session.id);
    const copySession = await backend.getDoc(`sessions/${newSid}`);
    if (!copySession) {
      diffs.push(`session ${session.id}: no copy at ${newSid}`);
      continue;
    }
    // The slice hashes on both sides, before the inverse maps are built.
    if (session.slices && copySession.slices)
      m.slice.set(session.id, {
        from: session.slices.hash,
        to: copySession.slices.hash,
      });
    const back = invert(m);

    if (session.slices && copySession.slices) {
      const texts = [];
      for (const n of copySession.slices.corners ?? []) {
        const file = await backend.readFile(
          `${copySession.slices.prefix}/c${n}.json.gz`,
        );
        const before = await backend.readFile(
          `${session.slices.prefix}/c${n}.json.gz`,
        );
        if (!file || !before) {
          diffs.push(`session ${newSid}: slice file c${n} missing on one side`);
          continue;
        }
        const now = textOrNull(file.bytes);
        const was = textOrNull(before.bytes);
        if (now === null || was === null) {
          diffs.push(
            `session ${newSid}: slice c${n} is not valid gzip on one side`,
          );
          continue;
        }
        texts.push(now);
        let rebuilt = null;
        try {
          rebuilt = mapSliceText(now, back);
        } catch (e) {
          diffs.push(`session ${newSid}: slice c${n}: ${e.message}`);
          continue;
        }
        if (rebuilt !== was)
          diffs.push(
            `session ${newSid}: slice c${n} mapped back is not the original`,
          );
        if (!sameMeta(file.meta, before.meta))
          diffs.push(`session ${newSid}: slice c${n} metadata differs`);
      }
      if (texts.length && sliceHash(texts) !== copySession.slices.hash)
        diffs.push(
          `session ${newSid}: slice files do not hash to ${copySession.slices.hash}`,
        );
    } else if (Boolean(session.slices) !== Boolean(copySession.slices)) {
      diffs.push(`session ${newSid}: slices on only one side`);
    }

    // Documents mapped back.
    const check = (kind, copy, mapBack, original) => {
      let restored;
      try {
        restored = mapBack(copy);
      } catch (e) {
        diffs.push(`${kind}/${copy.id}: ${e.message}`);
        return;
      }
      const orig = original.get(restored.id);
      if (!orig) diffs.push(`${kind}/${copy.id}: has no original`);
      else if (!sameDoc(restored, orig))
        diffs.push(
          `${kind}/${copy.id}: differs from ${restored.id} beyond the owner and ids`,
        );
    };
    check(
      'sessions',
      copySession,
      d => mapSession(d, back),
      new Map([[session.id, session]]),
    );
    const recIds = [...m.rec.values()];
    const lapIds = [...m.lap.values()];
    const copyRecs = await mapLimit(recIds, conc.docs, id =>
      backend.getDoc(`recordings/${id}`),
    );
    const copyLaps = await mapLimit(lapIds, conc.docs, id =>
      backend.getDoc(`laps/${id}`),
    );
    const origRecs = new Map(old.recordings.map(r => [r.id, r]));
    const origLaps = new Map(old.laps.map(l => [l.id, l]));
    recIds.forEach((id, i) => {
      if (!copyRecs[i]) diffs.push(`recordings/${id}: missing`);
      else
        check('recordings', copyRecs[i], d => mapRecording(d, back), origRecs);
    });
    lapIds.forEach((id, i) => {
      if (!copyLaps[i]) diffs.push(`laps/${id}: missing`);
      else check('laps', copyLaps[i], d => mapLap(d, back), origLaps);
    });

    // Files: bytes and metadata.
    const paths = [];
    for (const l of old.laps) if (l.trace?.path) paths.push(l.trace.path);
    if (session.band?.path) paths.push(session.band.path);
    if (session.field?.path) paths.push(session.field.path);
    for (const r of old.recordings) {
      if (r.archive?.samples) paths.push(r.archive.samples);
      if (r.archive?.events) paths.push(r.archive.events);
    }
    await mapLimit(paths, conc.stat, async path => {
      const a = await backend.statFile(path);
      if (!a) return; // missing in the original too: reported by the plan
      const target = mapPath(path, m);
      const b = await backend.statFile(target);
      if (!b) diffs.push(`${target}: missing`);
      else if (b.md5 !== a.md5)
        diffs.push(`${target}: bytes differ from ${path}`);
      else if (!sameMeta(a, b))
        diffs.push(
          `${target}: contentType/contentEncoding/cacheControl differ from ${path}`,
        );
    });
  }
  return diffs;
}
