// Write one analyzed session to Firestore and the bucket.
//
// Layout (docs/STORAGE.md):
//   gs://BUCKET/archive/{sim}/{sessionId}/{recordingId}/samples.parquet
//   gs://BUCKET/archive/{sim}/{sessionId}/{recordingId}/events.parquet
//   gs://BUCKET/traces/{ownerId}/{lapId}/v2.csv.gz
//   gs://BUCKET/bands/{ownerId}/{sessionId}/v1.json.gz
//   gs://BUCKET/field/{ownerId}/{sessionId}/{contentHash}.json.gz  (every car, 5 Hz; field.mjs)
//   gs://BUCKET/slices/{ownerId}/{sessionId}/{contentHash}/c{n}.json.gz  (every lap around corner n; cornerSlices.mjs)
//   Firestore recordings/{recordingId}, sessions/{sessionId}, laps/{lapId},
//             tracks/{trackId} (the corner map)
//   gs://BUCKET/surface/{trackId}/v1.json.gz  (measured track surface; surface.mjs, not written by sync)
import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {gunzipSync, gzipSync} from 'node:zlib';
import {
  classBestsCurrent,
  classBestsDoc,
  classLapsCurrent,
  classLapsDoc,
} from '../../src/analysis/classLaps.ts';
import {
  finishCurrent,
  finishDoc,
  finishOf,
} from '../../src/analysis/raceResult.ts';
import {
  fieldAfterSync,
  fieldFeedsDerived,
  fieldMissingAfter,
  madeFromField,
  stampField,
} from './field.mjs';
import {relabelField} from './irClasses.mjs';
import {keepVisits, onlineAfterSync, raceAfterSync} from './keepCapture.mjs';
import {planBlock} from './planBlock.mjs';
import {stampNewer, withKept} from './versionKey.mjs';
import {captureExtractPath} from './captureExtract.mjs';
import {resultsInputPath} from './resultsInput.mjs';
import {guardedWriter} from './docShape.mjs';
import {clipSpans, healPlan, lapsToAdd, uncoveredPrefixS} from './heal.mjs';
import {LIVE_STAMP} from './liveSession.mjs';
import {packState} from './layoutBoundaries.mjs';
import {trafficMedians} from '../../src/analysis/traffic.ts';
import {lapTrafficFrom} from './lapTraffic.mjs';
import {withNetRetry} from './netRetry.mjs';
import {mapLimit} from './mapLimit.mjs';
import {verifyStored} from './verifyStored.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

export const bucketName = process.env.LMU_BUCKET || 'botracing-61-lmu';

let cached;

export function connect() {
  if (cached) return cached;
  const require = createRequire(resolve(repoRoot, 'functions/package.json'));
  let admin;
  try {
    admin = require('firebase-admin');
  } catch {
    throw new Error(
      'firebase-admin is missing. Run: npm ci --prefix functions',
    );
  }
  const adc = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.env.APPDATA &&
      resolve(
        process.env.APPDATA,
        'gcloud/application_default_credentials.json',
      ),
    resolve(homedir(), '.config/gcloud/application_default_credentials.json'),
  ].filter(Boolean);
  if (!adc.some(path => existsSync(path))) {
    throw new Error(
      'No Google Cloud credentials on this PC. Run: gcloud auth application-default login',
    );
  }
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.GCLOUD_PROJECT || 'botracing-61',
      storageBucket: bucketName,
    });
  }
  cached = {db: admin.firestore(), bucket: admin.storage().bucket(bucketName)};
  return cached;
}

// The storage seam. Everything this file decides (what to skip, what to keep
// from the stored session, what to delete afterwards) runs against a backend:
// a handful of primitives over Firestore documents and bucket files. The
// Admin backend below is the PC uploader of today; storeClient.mjs is the same
// primitives over HTTP, for machines that hold no Admin credentials.
//
// A backend is:
//   getDoc(coll, id)            -> data | null
//   writeDocs(ops)              -> void; ops are {op: 'set', coll, id, data, merge?}
//                                  or {op: 'delete', coll, id}; none are written
//                                  if the shape check refuses one
//   updateDocs(ops)             -> string[]; {coll, id, data}, merged into a document
//                                  that must exist; returns the writes that failed
//   sessionLapIds(sessionId)    -> string[]
//   sessionLapHashes(sessionId) -> {lapId: payloadHash | null}; optional, admin only
//   fileMd5(dest)               -> base64 md5 | null
//   putFile(dest, {localPath} | {body}, {contentType, gzip})
//   getFile(dest)               -> Buffer (as stored, gzipped) | null
//   deleteFile(dest)
//   listFiles(prefix)           -> string[] of dest names

async function putAdminFile(bucket, dest, source, {contentType, gzip}) {
  const metadata = {contentType, cacheControl: 'private, max-age=31536000'};
  if (source.localPath) {
    await withNetRetry(() =>
      bucket.upload(source.localPath, {
        destination: dest,
        resumable: false,
        metadata,
      }),
    );
    return;
  }
  const body = gzip ? gzipSync(source.body, {level: 9}) : source.body;
  if (gzip) metadata.contentEncoding = 'gzip';
  await withNetRetry(() =>
    bucket.file(dest).save(body, {resumable: false, metadata}),
  );
}

// gRPC codes worth retrying: deadline, exhausted, aborted, internal, unavailable.
const TRANSIENT = new Set([4, 8, 10, 13, 14]);

// A session write stamps `changedAt`: the session list's version is the newest
// stamp (functions/src/sessionStore.ts sessionsVersion). The upload route
// stamps the same field (functions/src/uploadApi.ts commit).
const stampSession = (coll, data) =>
  coll === 'sessions' ? {...data, changedAt: new Date().toISOString()} : data;

// `bucket` is only needed for the file primitives.
export function adminBackend({db, bucket}) {
  const ref = (coll, id) => db.collection(coll).doc(id);
  return {
    async getDoc(coll, id) {
      const doc = await ref(coll, id).get();
      return doc.exists ? doc.data() : null;
    },
    async writeDocs(ops) {
      // Every document is checked first (docShape.mjs): one Firestore would
      // refuse fails this session with the field path, before anything is
      // written.
      const writer = guardedWriter(db.bulkWriter());
      for (const {op, coll, id, data, merge} of ops) {
        if (op === 'delete') writer.delete(ref(coll, id));
        else
          writer.set(
            ref(coll, id),
            stampSession(coll, data),
            merge ? {merge: true} : undefined,
          );
      }
      await writer.close();
    },
    // bulkWriter drops a failed write without rejecting close(), so they are
    // collected here.
    async updateDocs(ops) {
      const writer = db.bulkWriter();
      const failed = [];
      writer.onWriteError(error => {
        if (TRANSIENT.has(error.code) && error.failedAttempts < 5) return true;
        failed.push(`${error.documentRef.path}: ${error.message}`);
        return false;
      });
      // Each update's promise rejects once onWriteError gives up. The failure
      // is already in `failed`; waiting on them keeps it from being unhandled.
      const writes = ops.map(({coll, id, data}) =>
        writer.update(ref(coll, id), stampSession(coll, data)),
      );
      await writer.close();
      await Promise.allSettled(writes);
      return failed;
    },
    async sessionLapIds(sessionId) {
      const found = await db
        .collection('laps')
        .where('sessionId', '==', sessionId)
        .select('supersededBy')
        .get();
      // Not a replaced lap (heal.mjs): the leftover cleanup keeps tombstones.
      return found.docs
        .filter(doc => !doc.get('supersededBy'))
        .map(doc => doc.id);
    },
    // Id -> the `payloadHash` each live lap doc carries (null for a doc from
    // before hashes). The same query as sessionLapIds.
    async sessionLapHashes(sessionId) {
      const found = await db
        .collection('laps')
        .where('sessionId', '==', sessionId)
        .select('supersededBy', 'payloadHash')
        .get();
      const out = {};
      for (const doc of found.docs)
        if (!doc.get('supersededBy'))
          out[doc.id] = doc.get('payloadHash') ?? null;
      return out;
    },
    async fileMd5(dest) {
      try {
        const [meta] = await withNetRetry(() =>
          bucket.file(dest).getMetadata(),
        );
        return meta.md5Hash;
      } catch (error) {
        if (error?.code === 404) return null;
        throw error;
      }
    },
    putFile: (dest, source, options) =>
      putAdminFile(bucket, dest, source, options),
    async getFile(dest) {
      try {
        const [gz] = await bucket.file(dest).download({decompress: false});
        return gz;
      } catch (error) {
        if (error?.code === 404) return null;
        throw error;
      }
    },
    async deleteFile(dest) {
      await bucket.file(dest).delete({ignoreNotFound: true});
    },
    async listFiles(prefix) {
      const [files] = await bucket.getFiles({prefix});
      return files.map(f => f.name);
    },
  };
}

// The layout's corner boundaries, when a session changed them: the full state
// in its own doc, and the summary the app draws from on the track doc.
// `boundaries` is {trackId, state, windows}; `writer` anything with
// set(ref, data, options), a Firestore bulkWriter in the uploader.
export function writeBoundaries(db, writer, {trackId, state, windows}) {
  writer.set(db.collection('trackBoundaries').doc(trackId), packState(state));
  writer.set(
    db.collection('tracks').doc(trackId),
    {
      id: trackId,
      boundaries: {
        v: state.v,
        rev: state.rev,
        startsM: state.startsM,
        marginM: state.marginM,
        windows,
      },
    },
    {merge: true},
  );
}

// The same writes as backend ops.
function boundaryOps(boundaries) {
  const ops = [];
  const shim = {
    collection: coll => ({doc: id => ({path: `${coll}/${id}`, coll, id})}),
  };
  const writer = {
    set: (r, data, options) =>
      ops.push({
        op: 'set',
        coll: r.coll,
        id: r.id,
        data,
        merge: options?.merge,
      }),
  };
  writeBoundaries(shim, writer, boundaries);
  return ops;
}

// out is what sync.mjs builds: {session, recordings, laps, band, track,
// traces, files}. track is set only when this session made a new corner map.
// A drive the stored session does not have yet (a practice's next run out
// of the garage): new data, written whatever the stamps say. It lands with
// this writer's stamp and reads stale until opened (pit-wall thread 1 #4651).
// A live session's next lap is new data the same way: one more archive part
// (pit-wall thread 66).
function bringsNewRecordings(before, session) {
  const stored = new Set(before?.recordingIds ?? []);
  if ((session.recordingIds ?? []).some(id => !stored.has(id))) return true;
  return (session.archiveParts ?? 0) > (before?.archiveParts ?? 0);
}

// A live session's lap uploaded while this analysis ran (most of its time
// goes on the files and laps above): read the doc again right before the
// session write and keep what the upload set. Never roll the live stamp back
// (liveAnalyze's re-run watches it; sidepod on #614), and keep the stored
// part count and leave the session stale, so the new lap is analysed too.
// The window left is one read to one write; a lap landing in it is still
// picked up by the next lap's run, or by an open. ISO times compare as text.
//
// The same live stamp as this analysis read, with a higher stored count, is no
// lap that arrived: every live upload sets the stamp in the same write as the
// part count. It is a counter that drifted from the recordings (the heal
// replaced them, thread 103), and keeping it would hold the session stale for
// good. `healed`: this write is the heal's own, whose recordings the stored
// count never described.
export function keepNewerLive(
  session,
  stored,
  log = () => {},
  {healed = false} = {},
) {
  // The cloud's analysis writes the whole session doc: the heal's note stays.
  if (stored?.rebuilt && !session.rebuilt) session.rebuilt = stored.rebuilt;
  const storedLive = stored?.live?.updatedAt;
  const sameStamp =
    typeof storedLive === 'string' && storedLive === session.live?.updatedAt;
  if (
    typeof storedLive === 'string' &&
    storedLive > (session.live?.updatedAt ?? '')
  )
    session.live = stored.live;
  if (
    !healed &&
    !sameStamp &&
    (stored?.archiveParts ?? 0) > (session.archiveParts ?? 0)
  ) {
    session.archiveParts = stored.archiveParts;
    session.analysis = {...session.analysis, v: 0};
    log('  a lap arrived during this analysis: left stale');
  }
}

// The heal's writes for a session being rebuilt over its live copy (heal.mjs).
async function healOps(backend, before, out, log) {
  const {session} = out;
  const ids = (before?.recordingIds ?? []).filter(
    id => !out.recordings.some(r => r.id === id),
  );
  if (ids.length === 0) return null;
  const stored = (
    await Promise.all(
      ids.map(async id => ({id, ...(await backend.getDoc('recordings', id))})),
    )
  ).filter(r => r.recordedAt);
  const laps = (
    await Promise.all(
      (
        await backend.sessionLapIds(session.id)
      ).map(async id => ({
        id,
        ...(await backend.getDoc('laps', id)),
      })),
    )
  ).map(l => ({id: l.id, recordingId: l.recordingId}));
  const plan = healPlan({
    stored,
    built: out.recordings,
    laps,
    ownerId: session.ownerId,
    nowIso: new Date().toISOString(),
    defect: out.healDefect,
  });
  // A stretch the build lacks is the only copy: it stays in the session.
  session.recordingIds = [...session.recordingIds, ...plan.kept];
  log(
    `  heal: ${
      Object.keys(plan.replaced).length
    } recording(s) replaced (${Object.entries(plan.replaced)
      .map(([a, b]) => `${a} -> ${b}`)
      .join(', ')}), ${plan.lapsSuperseded} lap(s) hidden, ${
      plan.kept.length
    } stretch(es) kept (${plan.kept.join(', ')})`,
  );
  const kept = new Set(plan.kept);
  // The session says it was rebuilt (its header line), and a kept stretch
  // needs the cloud to analyse it again: the live stamp reads stale, so the
  // next open runs every stored recording, the kept stretch's laps get their
  // tyres withdrawn and the aggregates include them (plank #5676).
  session.rebuilt = {
    at: new Date().toISOString(),
    replaced: Object.keys(plan.replaced).length,
    kept: plan.kept.length,
  };
  if (plan.kept.length > 0) session.analysis = {...LIVE_STAMP};
  return {
    ops: plan.ops,
    protectedLapIds: laps
      .filter(l => kept.has(l.recordingId) || l.recordingId in plan.replaced)
      .map(l => l.id),
  };
}

/**
 * The drive's earlier copy under another id (a hand rebuild) once the healed
 * session holds it: the session doc, its recordings and its laps are
 * tombstoned (heal.mjs: hidden from lists, readable by id, kept 30 days).
 */
async function supersedeSession(backend, oldId, byId, nowIso) {
  const old = await backend.getDoc('sessions', oldId);
  if (!old || old.supersededBy) return null;
  // ownerId: the upload API refuses a merge that does not name its owner.
  const mark = {ownerId: old.ownerId, supersededBy: byId, supersededAt: nowIso};
  const ops = [
    {op: 'set', coll: 'sessions', id: oldId, data: mark, merge: true},
  ];
  // A hand rebuild of the same game files has the same recording ids as the
  // healed session (an id is the owner and the file's own content): those
  // recordings are the healed session's now and stay live. Its laps are
  // already the healed session's too (sessionLapIds asks by session id).
  const kept = new Set(
    (await backend.getDoc('sessions', byId))?.recordingIds ?? [],
  );
  const recordingIds = (old.recordingIds ?? []).filter(id => !kept.has(id));
  for (const id of recordingIds)
    ops.push({op: 'set', coll: 'recordings', id, data: mark, merge: true});
  const lapIds = await backend.sessionLapIds(oldId);
  for (const id of lapIds)
    ops.push({op: 'set', coll: 'laps', id, data: mark, merge: true});
  await backend.writeDocs(ops);
  return {recordings: recordingIds.length, laps: lapIds.length};
}

/**
 * The content hash of a lap doc's payload, kept on the doc as `payloadHash`:
 * the hash and the doc land in one write, so a stored hash always names the
 * stored payload (no crash window, no second writer to fence).
 */
export function lapHash(lap) {
  return createHash('sha1').update(JSON.stringify(lap)).digest('hex');
}

async function uploadSession(backend, out, {log = () => {}} = {}) {
  const {session} = out;

  // Never older analysis over newer, checked before any file is written: a
  // PC behind the cloud's code leaves a session the cloud already analysed
  // alone (pit-wall thread 1 #4573).
  const before = await backend.getDoc('sessions', session.id);
  // Replaced by a healed session: nothing builds it again.
  if (before?.supersededBy) {
    log(`  skipped: replaced by ${before.supersededBy}`);
    return {skipped: 'superseded'};
  }
  if (
    stampNewer(before?.analysis, session.analysis) &&
    !bringsNewRecordings(before, session)
  ) {
    log('  skipped: the stored session was analysed under newer rules');
    return {skipped: 'newer'};
  }

  // The field file already in the bucket (the capture is gone after 14 days,
  // the uploaded file is not). A failure is a log line and null: the next
  // sync tries again.
  const readStoredField = async path => {
    try {
      const gz = await backend.getFile(path);
      return gz ? JSON.parse(gunzipSync(gz).toString('utf8')) : null;
    } catch (e) {
      log(`  field: could not read the stored one: ${e.message}`);
      return null;
    }
  };

  // Re-running analysis (a new analysisVersion) rebuilds the same archive
  // bytes. Skip files the bucket already holds, so only the analysis uploads.
  let sent = 0;
  for (const file of out.files) {
    const local = createHash('md5')
      .update(readFileSync(file.local))
      .digest('base64');
    if ((await backend.fileMd5(file.dest)) === local) continue;
    await backend.putFile(
      file.dest,
      {localPath: file.local},
      {contentType: 'application/vnd.apache.parquet'},
    );
    sent++;
  }
  log(`  archive ${sent} of ${out.files.length} files sent`);

  const putGzip = (dest, text, contentType) =>
    backend.putFile(
      dest,
      {body: Buffer.from(text, 'utf8')},
      {contentType, gzip: true},
    );

  // A finished lap's trace is the same bytes on every run (both stores gzip at
  // level 9, which is deterministic), so only a trace whose md5 differs from
  // the stored one is sent: a live session's runs no longer rewrite every lap
  // they already wrote (lap 30 of a race: 10 of a 27 s run was the write;
  // pit wall thread 69 #5718).
  let traces = 0;
  await mapLimit(out.traces, 8, async job => {
    const text = job.csv();
    const md5 = createHash('md5')
      .update(gzipSync(Buffer.from(text, 'utf8'), {level: 9}))
      .digest('base64');
    if ((await backend.fileMd5(job.dest)) === md5) return;
    await putGzip(job.dest, text, 'text/csv');
    traces++;
  });
  log(`  traces ${traces} of ${out.traces.length} sent`);

  if (out.captureExtract)
    await putGzip(
      captureExtractPath(session.ownerId, session.id),
      JSON.stringify(out.captureExtract),
      'application/json',
    );
  if (out.resultsInput)
    await putGzip(
      resultsInputPath(session.ownerId, session.id),
      JSON.stringify(out.resultsInput),
      'application/json',
    );
  if (out.band) {
    await putGzip(
      session.band.path,
      JSON.stringify(out.band),
      'application/json',
    );
  }
  // Corner slices: one file per corner under a content-hash folder, so a
  // resync that changes them writes a new folder and the old one goes after
  // the session doc points at the new (below).
  if (out.slices) {
    await Promise.all(
      out.slices.files.map(f =>
        putGzip(
          `${session.slices.prefix}/c${f.n}.json.gz`,
          f.text,
          'application/json',
        ),
      ),
    );
    log(`  slices ${out.slices.files.length} corners`);
  }
  // The field: a new one replaces the stored one (and its file goes after the
  // doc points at the new one); no new one keeps what is stored (field.mjs).
  // An iRacing field uploaded before fields carried classes, its capture gone:
  // the stored file with every car's class from the .ibt, as a new file that
  // replaces it (irClasses.relabelField).
  let relabeled = null;
  if (!session.field && before?.field && out.ibtDrivers?.length) {
    const stored = await readStoredField(before.field.path);
    relabeled = stored && relabelField(stored, out.ibtDrivers);
    if (relabeled) {
      out.fieldText = JSON.stringify(relabeled);
      const hash = createHash('sha1')
        .update(out.fieldText)
        .digest('hex')
        .slice(0, 12);
      session.field = {
        ...before.field,
        path: `field/${session.ownerId}/${session.id}/${hash}.json.gz`,
        hash,
      };
      session.classLaps = classLapsDoc(relabeled, session.sessionType);
      session.classBests = classBestsDoc(relabeled, session.sessionType);
      session.result = finishDoc(relabeled, session.sessionType);
      log('  field: classes added from the .ibt');
    }
  }
  const kept = fieldAfterSync(session.field, before?.field ?? null);
  // A covered game file keeps the live session's field, put back with the
  // doc below. Uploading or recomputing here would delete that file, or
  // rewrite blocks the put-back then throws away.
  if (out.healLack && before) {
    kept.field = null;
    kept.upload = false;
    kept.deletePath = null;
    kept.keptAside = null;
  }
  session.field = kept.field;
  session.fieldMissing = fieldMissingAfter(
    kept.field,
    out.fieldReason,
    before?.fieldMissing,
  );
  if (kept.keptAside) {
    await putGzip(kept.keptAside.path, out.fieldText, 'application/json');
    log('  field: smaller one kept aside');
  } else if (kept.upload) {
    await putGzip(session.field.path, out.fieldText, 'application/json');
    session.result = stampField(session.result, session.field);
    session.classLaps = stampField(session.classLaps, session.field);
    session.classBests = stampField(session.classBests, session.field);
    if (relabeled) {
      const traffic = await lapTrafficFrom({
        fresh: relabeled,
        stored: null,
        load: null,
        windows: out.lapWindows,
        session,
      });
      out.laps.forEach((lap, k) => {
        lap.traffic = traffic[k];
      });
    }
  } else if (kept.field && !fieldFeedsDerived(kept.field)) {
    // The file stays. A later sync must not refill traffic, class laps,
    // bests or the finish from a marked field (thread 100).
    session.classLaps = null;
    session.classBests = null;
    session.result = null;
    for (const lap of out.laps) lap.traffic = null;
    log('  field: marked, kept, not used');
  } else if (kept.field) {
    log('  field: kept the stored one');
    // Everything computed from the field is kept or worked out again from
    // the uploaded file, read once: the class lap times while they are this
    // version, this kind of session (an older analysis, a changed rule, a
    // re-typed session) and this field file (field.mjs madeFromField), and
    // the traffic of every lap, which would otherwise be written as null for
    // want of the capture.
    let loaded;
    const load = async () =>
      (loaded ??= await readStoredField(kept.field.path));
    // A block is worked out again from the field, named after it; a field
    // that can't be read keeps the stored block as it was (its old fieldHash
    // makes the next run try again), never null over good data.
    const fromField = async (name, stored, current, make) => {
      if (
        current(stored, session.sessionType) &&
        madeFromField(stored, kept.field)
      )
        return stored;
      const field = await load();
      if (field)
        return stampField(make(field, session.sessionType), kept.field);
      if (stored) log(`  field: unreadable, kept the stored ${name}`);
      return stored;
    };
    session.classLaps = await fromField(
      'classLaps',
      before?.classLaps ?? null,
      classLapsCurrent,
      classLapsDoc,
    );
    // The fastest cars of each class, the same way.
    session.classBests = await fromField(
      'classBests',
      before?.classBests ?? null,
      classBestsCurrent,
      classBestsDoc,
    );
    // The finishing position, the same way.
    session.result = await fromField(
      'result',
      before?.result ?? null,
      finishCurrent,
      finishDoc,
    );
    const traffic = await lapTrafficFrom({
      fresh: null,
      stored: kept.field,
      load,
      windows: out.lapWindows,
      session,
    });
    out.laps.forEach((lap, k) => {
      lap.traffic = traffic[k];
    });
  }
  // The game's own classification first: a race whose results input has the
  // drivers takes its finishing place from the file, whatever the field gave
  // above (one stored `result`, read by the list and the head alike).
  session.result = finishOf({
    drivers: out.resultsDrivers,
    sessionType: session.sessionType,
    field: session.result ?? null,
  });
  // What only the capture gave, kept when it is gone (keepCapture.mjs): the
  // race length, and the visits read from the car's damage.
  const keptBlocks = [];
  const freshRace = session.race;
  session.online = onlineAfterSync(session.online, before?.online);
  session.race = raceAfterSync(freshRace, before?.race ?? null, session);
  if (session.race && !freshRace) keptBlocks.push('raceLength');
  if (out.damageMissing) {
    const storedLaps = new Map();
    for (const lap of out.laps) {
      if (!lap.pitStop?.visit) continue;
      // An upload API that cannot read lap docs (an older server) keeps
      // nothing; it must not fail the sync.
      const doc = await backend.getDoc('laps', lap.id).catch(e => {
        log(`  pit visits: could not read lap ${lap.id}: ${e.message}`);
        return null;
      });
      if (doc) storedLaps.set(lap.id, doc);
    }
    const keptVisits = keepVisits(out.laps, storedLaps, {damageMissing: true});
    if (keptVisits) {
      keptBlocks.push('pitVisit');
      log(`  pit visits: kept ${keptVisits} stored (no damage record)`);
    }
  }
  if (session.analysis)
    session.analysis = withKept(
      session.analysis,
      keptBlocks,
      before?.analysis ?? null,
    );
  // The plan block reads the race, result, traffic and visits settled above.
  session.plan = planBlock({
    sessionType: session.sessionType,
    fuel: session.fuel,
    laps: out.laps,
    race: session.race,
    result: session.result,
  });
  session.traffic = trafficMedians(
    out.laps.map(lap => ({
      timeS: lap.lapTime,
      comparable: lap.comparable,
      traffic: lap.traffic,
    })),
  );

  if (out.healLack && before) {
    const ids = before.recordingIds ?? [];
    const storedRecs = (
      await Promise.all(
        ids.map(async id => ({
          id,
          ...(await backend.getDoc('recordings', id)),
        })),
      )
    ).filter(r => r.recordedAt);
    const prefix = uncoveredPrefixS(storedRecs, out.recordings);
    out.laps = lapsToAdd(storedRecs, out.recordings, out.laps);
    const extra = new Set(out.laps.map(l => l.recordingId));
    out.recordings = out.recordings.filter(r => extra.has(r.id));
    // The next open analyses every recording from its archive in full. The
    // spans name the stretch the live copy already owns, in this file's
    // clock, so that run drops those laps (analyze.mjs lapHitsClip).
    for (const rec of out.recordings) {
      const spans = clipSpans(storedRecs, rec);
      if (spans.length) rec.clipSpans = spans;
    }
    const recordingIds = [
      ...new Set([...ids, ...out.recordings.map(r => r.id)]),
    ];
    out.keepStoredLaps = true;
    // Those blocks name the game file's laps. The live doc keeps its own.
    // Laps that were added leave the stamp stale so the next open recomputes
    // the header from the stored laps plus the new ones.
    const added = out.laps.length;
    for (const key of Object.keys(session)) delete session[key];
    Object.assign(session, before, {recordingIds});
    if (added > 0) session.analysis = {...LIVE_STAMP};
    log(
      `  heal lack: ${added} lap(s) the live copy did not have` +
        (prefix ? `, ${prefix.seconds}s before the recorder` : ''),
    );
  }

  const ops = [];
  // The cloud's analysis writes no recording: they are stored, unchanged, and
  // the copy it read can be older than a part or an event the tray wrote
  // meanwhile (thread 103, 0dddbcb7).
  if (!out.recordingsAreStored)
    for (const rec of out.recordings)
      ops.push({op: 'set', coll: 'recordings', id: rec.id, data: rec});
  // A live session is analysed again on every lap and almost every lap doc
  // comes out the same (pit wall thread 101): a lap whose payload hashes as
  // the stored doc's `payloadHash` is not written again. A backend that cannot
  // read the hashes (the tray's HTTP one) writes every lap.
  const storedHashes = backend.sessionLapHashes
    ? await backend.sessionLapHashes(session.id)
    : null;
  const storedLapIds = new Set(
    storedHashes
      ? Object.keys(storedHashes)
      : await backend.sessionLapIds(session.id),
  );
  let lapsSkipped = 0;
  for (const lap of out.laps) {
    const payloadHash = lapHash(lap);
    if (!out.healDefect && storedHashes?.[lap.id] === payloadHash) {
      lapsSkipped++;
      continue;
    }
    ops.push({
      op: 'set',
      coll: 'laps',
      id: lap.id,
      data: {...lap, payloadHash},
    });
  }
  // A game-file build that replaces a live copy of the same drive in place
  // (heal.mjs): the stored recordings it covers, and their laps, are
  // tombstoned in the same batch; a stretch it lacks stays.
  const healed = out.healDefect
    ? await healOps(backend, before, out, log)
    : null;
  if (healed) ops.push(...healed.ops);
  // Merge: the track doc also holds fields other tools write (the georef,
  // centerline, edges, corner names). A new corner map replaces only its own.
  if (out.track) {
    ops.push({
      op: 'set',
      coll: 'tracks',
      id: out.track.id,
      data: out.track,
      merge: true,
    });
  }

  // The layout's corner boundaries, when this session changed them.
  if (out.boundaries) ops.push(...boundaryOps(out.boundaries));

  // A re-run can produce fewer laps (a file that was still growing). Drop leftovers.
  const keep = new Set(out.laps.map(lap => lap.id));
  // The heal's own: the kept stretch's laps stay, the replaced ones are
  // tombstoned by the ops above and must not also be deleted as leftovers.
  for (const id of healed?.protectedLapIds ?? []) keep.add(id);
  if (out.keepStoredLaps) {
    for (const id of await backend.sessionLapIds(session.id)) keep.add(id);
  }
  let dropped = 0;
  for (const id of storedLapIds) {
    if (!keep.has(id)) {
      ops.push({op: 'delete', coll: 'laps', id});
      dropped++;
    }
  }
  // The session doc goes last, on its own: it carries the analysis stamp, so
  // it must never land fresh over laps that did not. A failure before it
  // leaves the old stamp, and the session is analysed again.
  const writer = {stamp: session.analysis ?? null};
  await backend.writeDocs(ops, writer);
  keepNewerLive(session, await backend.getDoc('sessions', session.id), log, {
    healed: healed !== null,
  });
  await backend.writeDocs(
    [{op: 'set', coll: 'sessions', id: session.id, data: session}],
    writer,
  );
  // Only after the session points at the new file: a phone still holding the
  // old URL gets a 404 and refetches the session.
  if (kept.deletePath) await backend.deleteFile(kept.deletePath);
  // Slice folders of earlier syncs: everything under this session's slices
  // except the current hash.
  const old = await backend.listFiles(
    `slices/${session.ownerId}/${session.id}/`,
  );
  const current = session.slices ? `${session.slices.prefix}/` : null;
  for (const name of old) {
    if (!current || !name.startsWith(current)) await backend.deleteFile(name);
  }
  log(
    `  firestore 1 session, ${out.recordings.length} recordings, ${
      out.laps.length
    } laps${lapsSkipped ? ` (${lapsSkipped} unchanged)` : ''}${
      dropped ? `, dropped ${dropped}` : ''
    }`,
  );
}

// The store sync.mjs talks to, over any backend.
// Live laps (pit-wall thread 66, liveSession.mjs): a session's new archive
// parts, then its recording docs, then the session doc, merged so the fields a
// cloud analysis wrote stay until the next one. The docs go only after every
// part is up: an upload that fails part-way writes no doc, and the next lap
// sends every unlisted part the bucket lacks (md5), so a lap is never lost.
// Older-over-newer is refused unless a part is new.
// The live path's field file and capture extract (liveInputs.mjs), side by side.
async function putLiveInputs(backend, out, session, log) {
  const puts = [];
  if (out.fieldText && out.field)
    puts.push(
      backend
        .putFile(
          out.field.path,
          {body: Buffer.from(out.fieldText)},
          {contentType: 'application/json', gzip: true},
        )
        .then(() => log(`  live: field ${out.field.cars} cars`)),
    );
  if (out.captureExtract)
    puts.push(
      backend.putFile(
        captureExtractPath(session.ownerId, session.id),
        {body: Buffer.from(JSON.stringify(out.captureExtract))},
        {contentType: 'application/json', gzip: true},
      ),
    );
  if (out.resultsInput)
    puts.push(
      backend.putFile(
        resultsInputPath(session.ownerId, session.id),
        {body: Buffer.from(JSON.stringify(out.resultsInput))},
        {contentType: 'application/json', gzip: true},
      ),
    );
  await Promise.all(puts);
}

// Requests in flight at once on a live lap: each is a round trip to the API or
// a signed PUT of ~0.1 MB, so a few together cost about one.
const LIVE_CONCURRENCY = 6;

/**
 * A part a stored recording doc lists is in the bucket (the docs are written
 * only after every part is up, and a finished lap's part never changes), so a
 * lap asks the server only about the parts no doc lists yet. One md5 call per
 * part per lap made the upload grow with the drive (3.4 s at lap 1, 15.5 s at
 * lap 30; pit wall thread 69). A re-cut lap is the repair path's to send.
 */
async function uploadLive(backend, out, {log = () => {}} = {}) {
  const {session} = out;
  const [before, ...stored] = await Promise.all([
    backend.getDoc('sessions', session.id),
    ...out.recordings.map(rec => backend.getDoc('recordings', rec.id)),
  ]);
  if (
    stampNewer(before?.analysis, session.analysis) &&
    !bringsNewRecordings(before, session)
  ) {
    // No new lap, but a session from before live laps carried the field
    // (roadmap row 0a): its field and capture extract go up once, alone, and
    // the session reads stale so the next open works out the class laps,
    // bests and traffic from the field (uploadSession's kept-field path).
    if (out.fieldText && out.field && !before?.field) {
      await putLiveInputs(backend, out, session, log);
      await backend.writeDocs([
        {
          op: 'set',
          coll: 'sessions',
          id: session.id,
          data: {
            ownerId: session.ownerId,
            field: out.field,
            analysis: {...before.analysis, v: 0},
          },
          merge: true,
        },
      ]);
      log('  live: field added to the stored session; it reads stale');
      return {skipped: 'newer', field: 'added'};
    }
    log('  live: nothing new over the stored session');
    return {skipped: 'newer'};
  }
  const listed = new Set(
    stored.flatMap(rec =>
      (rec?.archive?.parts ?? []).flatMap(p => [p.samples, p.events]),
    ),
  );
  let sent = 0;
  const parts = mapLimit(
    out.files.filter(file => !listed.has(file.dest)),
    LIVE_CONCURRENCY,
    async file => {
      const local = createHash('md5')
        .update(readFileSync(file.local))
        .digest('base64');
      if ((await backend.fileMd5(file.dest)) === local) return;
      await backend.putFile(
        file.dest,
        {localPath: file.local},
        {contentType: 'application/vnd.apache.parquet'},
      );
      sent++;
    },
  );
  // The field and the capture extract the live path made (liveInputs.mjs),
  // beside the parts: the field is named by its content, so an unchanged one
  // is not sent again; the session then points at it, and analysis keeps and
  // reads it (the kept-field path in uploadSession). The extract is a few KB.
  const newField =
    out.fieldText && out.field && out.field.hash !== before?.field?.hash;
  const inputs = putLiveInputs(
    backend,
    newField ? out : {...out, fieldText: null},
    session,
    log,
  );
  await Promise.all([parts, inputs]);
  if (newField) session.field = out.field;
  else if (before?.field) session.field = before.field;
  session.fieldMissing = fieldMissingAfter(
    session.field,
    out.fieldReason,
    before?.fieldMissing,
  );
  const ops = out.recordings.map(rec => ({
    op: 'set',
    coll: 'recordings',
    id: rec.id,
    data: rec,
  }));
  ops.push({
    op: 'set',
    coll: 'sessions',
    id: session.id,
    data: session,
    merge: true,
  });
  await backend.writeDocs(ops);
  log(
    `  live: ${sent} of ${out.files.length} parts sent, ${session.lapCount} laps`,
  );
  return {sent};
}

export function createStore(backend) {
  return {
    // A track's stored corner map, or null.
    getTrack: trackId => backend.getDoc('tracks', trackId),
    // One session doc (the heal asks whether a live session still exists).
    getSession: id => backend.getDoc('sessions', id),
    supersedeSession: (oldId, byId, nowIso) =>
      supersedeSession(backend, oldId, byId, nowIso),
    // A track's corner boundaries (tools/sessions/layoutBoundaries.mjs),
    // packed, or null. A doc of its own: it grows with every session of the
    // layout, and the app reads only the small summary on the track doc.
    getBoundaries: trackId => backend.getDoc('trackBoundaries', trackId),
    // The same writes on their own, for the fold pass that runs before any
    // session is uploaded.
    putBoundaries: boundaries => backend.writeDocs(boundaryOps(boundaries)),
    // Which online event each session was, without re-uploading anything
    // else. update, not set: a session that was never uploaded stays absent.
    // items: [{session: {id, series, eventId}, recordings: [{id, event}]}]
    // Returns the writes that failed, as "collection/id: reason".
    updateEvents(items) {
      const ops = [];
      for (const {session, recordings} of items) {
        ops.push({
          coll: 'sessions',
          id: session.id,
          data: {series: session.series, eventId: session.eventId},
        });
        for (const rec of recordings)
          ops.push({coll: 'recordings', id: rec.id, data: {event: rec.event}});
      }
      return backend.updateDocs(ops);
    },
    upload: (out, options) => uploadSession(backend, out, options),
    // The uploaded session read back (verifyStored.mjs): what lets the tray
    // delete the captures it read.
    verify: (out, options) => verifyStored(backend, out, options),
    uploadLive: (out, options) => uploadLive(backend, out, options),
    // One archive file put in place of the stored one when their bytes
    // differ; true when it was sent.
    async replaceArchiveFile(dest, localPath) {
      const local = createHash('md5')
        .update(readFileSync(localPath))
        .digest('base64');
      if ((await backend.fileMd5(dest)) === local) return false;
      await backend.putFile(
        dest,
        {localPath},
        {contentType: 'application/vnd.apache.parquet'},
      );
      return true;
    },
    // A session whose archive changed under it: it reads stale, so the next
    // open analyses it again from the new archive (analysis on open). Merged:
    // only the stamp's version goes, every stored block stays.
    // ownerId: the upload API refuses a doc that does not name its owner.
    // A session that is not stored (deleted, or a live drive whose first lap
    // never went up) is left alone: a merge would create a session doc that
    // holds nothing but the stamp. Returns whether it marked one.
    async markStale(sessionId, ownerId) {
      if (!(await backend.getDoc('sessions', sessionId))) return false;
      await backend.writeDocs([
        {
          op: 'set',
          coll: 'sessions',
          id: sessionId,
          data: {ownerId, analysis: {v: 0}},
          merge: true,
        },
      ]);
      return true;
    },
    // A session's capture extract on its own (captureExtract.mjs), for the
    // sessions uploaded before extracts were kept.
    putCaptureExtract: (ownerId, sessionId, extract) =>
      backend.putFile(
        captureExtractPath(ownerId, sessionId),
        {body: Buffer.from(JSON.stringify(extract), 'utf8')},
        {contentType: 'application/json', gzip: true},
      ),
    // A session's results input on its own (resultsInput.mjs): the sessions
    // uploaded before the game's results were kept, and a live session at its
    // close, when the game writes the file.
    putResultsInput: (ownerId, sessionId, input) =>
      backend.putFile(
        resultsInputPath(ownerId, sessionId),
        {body: Buffer.from(JSON.stringify(input), 'utf8')},
        {contentType: 'application/json', gzip: true},
      ),
  };
}

// The PC uploader's store: Admin credentials, connected on first use.
const admin = () => createStore(adminBackend(connect()));

export const getTrack = trackId => admin().getTrack(trackId);
export const updateEvents = items => admin().updateEvents(items);
export const upload = (out, options) => admin().upload(out, options);
export const verify = (out, options) => admin().verify(out, options);
export const putCaptureExtract = (ownerId, sessionId, extract) =>
  admin().putCaptureExtract(ownerId, sessionId, extract);
export const putResultsInput = (ownerId, sessionId, input) =>
  admin().putResultsInput(ownerId, sessionId, input);
export const markStale = (sessionId, ownerId) =>
  admin().markStale(sessionId, ownerId);
export const getBoundaries = (trackId, db) =>
  createStore(adminBackend({db: db ?? connect().db})).getBoundaries(trackId);
export const putBoundaries = (boundaries, db) =>
  createStore(adminBackend({db: db ?? connect().db})).putBoundaries(boundaries);
