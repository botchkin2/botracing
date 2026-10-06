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
import {classLapsCurrent, classLapsDoc} from '../../src/analysis/classLaps.ts';
import {finishCurrent, finishDoc} from '../../src/analysis/raceResult.ts';
import {fieldAfterSync} from './field.mjs';
import {guardedWriter} from './docShape.mjs';
import {packState} from './layoutBoundaries.mjs';
import {trafficMedians} from '../../src/analysis/traffic.ts';
import {lapTrafficFrom} from './lapTraffic.mjs';
import {withNetRetry} from './netRetry.mjs';

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
        else writer.set(ref(coll, id), data, merge ? {merge: true} : undefined);
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
        writer.update(ref(coll, id), data),
      );
      await writer.close();
      await Promise.allSettled(writes);
      return failed;
    },
    async sessionLapIds(sessionId) {
      const found = await db
        .collection('laps')
        .where('sessionId', '==', sessionId)
        .select()
        .get();
      return found.docs.map(doc => doc.id);
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
async function uploadSession(backend, out, {log = () => {}} = {}) {
  const {session} = out;

  // The field file already in the bucket (the capture is gone after 7 days,
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

  let traces = 0;
  const queue = [...out.traces];
  const workers = Array.from({length: 8}, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      await putGzip(job.dest, job.csv(), 'text/csv');
      traces++;
    }
  });
  await Promise.all(workers);
  log(`  traces ${traces}`);

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
  const before = await backend.getDoc('sessions', session.id);
  const kept = fieldAfterSync(session.field, before?.field ?? null);
  session.field = kept.field;
  if (kept.upload) {
    await putGzip(session.field.path, out.fieldText, 'application/json');
  } else if (kept.field) {
    log('  field: kept the stored one');
    // Everything computed from the field is kept or worked out again from
    // the uploaded file, read once: the class lap times while they are this
    // version and this kind of session (an older analysis, a changed rule, a
    // re-typed session), and the traffic of every lap, which would otherwise
    // be written as null for want of the capture.
    let loaded;
    const load = async () =>
      (loaded ??= await readStoredField(kept.field.path));
    const stored = before?.classLaps ?? null;
    if (classLapsCurrent(stored, session.sessionType)) {
      session.classLaps = stored;
    } else {
      const field = await load();
      session.classLaps = field
        ? classLapsDoc(field, session.sessionType)
        : null;
    }
    // The finishing position, kept while it is this version and kind.
    const storedResult = before?.result ?? null;
    if (finishCurrent(storedResult, session.sessionType)) {
      session.result = storedResult;
    } else {
      const field = await load();
      session.result = field ? finishDoc(field, session.sessionType) : null;
    }
    const traffic = await lapTrafficFrom({
      fresh: null,
      stored: kept.field,
      load,
      windows: out.lapWindows,
    });
    out.laps.forEach((lap, k) => {
      lap.traffic = traffic[k];
    });
  }
  session.traffic = trafficMedians(
    out.laps.map(lap => ({
      timeS: lap.lapTime,
      comparable: lap.comparable,
      traffic: lap.traffic,
    })),
  );

  const ops = [];
  for (const rec of out.recordings)
    ops.push({op: 'set', coll: 'recordings', id: rec.id, data: rec});
  for (const lap of out.laps)
    ops.push({op: 'set', coll: 'laps', id: lap.id, data: lap});
  ops.push({op: 'set', coll: 'sessions', id: session.id, data: session});
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
  let dropped = 0;
  for (const id of await backend.sessionLapIds(session.id)) {
    if (!keep.has(id)) {
      ops.push({op: 'delete', coll: 'laps', id});
      dropped++;
    }
  }
  await backend.writeDocs(ops);
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
    } laps${dropped ? `, dropped ${dropped}` : ''}`,
  );
}

// The store sync.mjs talks to, over any backend.
export function createStore(backend) {
  return {
    // A track's stored corner map, or null.
    getTrack: trackId => backend.getDoc('tracks', trackId),
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
  };
}

// The PC uploader's store: Admin credentials, connected on first use.
const admin = () => createStore(adminBackend(connect()));

export const getTrack = trackId => admin().getTrack(trackId);
export const updateEvents = items => admin().updateEvents(items);
export const upload = (out, options) => admin().upload(out, options);
export const getBoundaries = (trackId, db) =>
  createStore(adminBackend({db: db ?? connect().db})).getBoundaries(trackId);
export const putBoundaries = (boundaries, db) =>
  createStore(adminBackend({db: db ?? connect().db})).putBoundaries(boundaries);
