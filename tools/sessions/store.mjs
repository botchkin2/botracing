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

async function putFile(bucket, localPath, dest, contentType) {
  await withNetRetry(() =>
    bucket.upload(localPath, {
      destination: dest,
      resumable: false,
      metadata: {contentType, cacheControl: 'private, max-age=31536000'},
    }),
  );
}

async function sameAsRemote(bucket, localPath, dest) {
  try {
    const [meta] = await withNetRetry(() => bucket.file(dest).getMetadata());
    const local = createHash('md5')
      .update(readFileSync(localPath))
      .digest('base64');
    return meta.md5Hash === local;
  } catch (error) {
    if (error?.code === 404) return false;
    throw error;
  }
}

// The field file already in the bucket (the capture is gone after 7 days,
// the uploaded file is not). A failure is a log line and null: the next sync
// tries again.
async function readStoredField(bucket, path, log) {
  try {
    const [gz] = await bucket.file(path).download({decompress: false});
    return JSON.parse(gunzipSync(gz).toString('utf8'));
  } catch (e) {
    log(`  field: could not read the stored one: ${e.message}`);
    return null;
  }
}

async function putGzip(bucket, dest, text, contentType) {
  const body = gzipSync(Buffer.from(text, 'utf8'), {level: 9});
  await withNetRetry(() =>
    bucket.file(dest).save(body, {
      resumable: false,
      metadata: {
        contentType,
        contentEncoding: 'gzip',
        cacheControl: 'private, max-age=31536000',
      },
    }),
  );
}

// A track's stored corner map, or null.
export async function getTrack(trackId) {
  const {db} = connect();
  const doc = await db.collection('tracks').doc(trackId).get();
  return doc.exists ? doc.data() : null;
}

// A track's corner boundaries (tools/sessions/layoutBoundaries.mjs), packed,
// or null. A doc of its own: it grows with every session of the layout, and
// the app reads only the small summary on the track doc.
export async function getBoundaries(trackId, db = connect().db) {
  const doc = await db.collection('trackBoundaries').doc(trackId).get();
  return doc.exists ? doc.data() : null;
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

// The same writes on their own, for the fold pass that runs before any
// session is uploaded.
export async function putBoundaries(boundaries, db = connect().db) {
  const writer = guardedWriter(db.bulkWriter());
  writeBoundaries(db, writer, boundaries);
  await writer.close();
}

// Which online event each session was, without re-uploading anything else.
// update, not set: a session that was never uploaded stays absent.
// items: [{session: {id, series, eventId}, recordings: [{id, event}]}]
// Returns the writes that failed, as "collection/id: reason". bulkWriter
// drops a failed write without rejecting close(), so they are collected here.
export async function updateEvents(items) {
  const {db} = connect();
  const writer = db.bulkWriter();
  const failed = [];
  // gRPC codes worth retrying: deadline, exhausted, aborted, internal, unavailable.
  const transient = new Set([4, 8, 10, 13, 14]);
  writer.onWriteError(error => {
    if (transient.has(error.code) && error.failedAttempts < 5) return true;
    failed.push(`${error.documentRef.path}: ${error.message}`);
    return false;
  });
  // Each update's promise rejects once onWriteError gives up. The failure is
  // already in `failed`; waiting on them keeps it from being unhandled.
  const writes = [];
  for (const {session, recordings} of items) {
    writes.push(
      writer.update(db.collection('sessions').doc(session.id), {
        series: session.series,
        eventId: session.eventId,
      }),
    );
    for (const rec of recordings)
      writes.push(
        writer.update(db.collection('recordings').doc(rec.id), {
          event: rec.event,
        }),
      );
  }
  await writer.close();
  await Promise.allSettled(writes);
  return failed;
}

// out is what sync.mjs builds: {session, recordings, laps, band, track,
// traces, files}. track is set only when this session made a new corner map.
export async function upload(out, {log = () => {}} = {}) {
  const {db, bucket} = connect();
  const {session} = out;

  // Re-running analysis (a new analysisVersion) rebuilds the same archive
  // bytes. Skip files the bucket already holds, so only the analysis uploads.
  let sent = 0;
  for (const file of out.files) {
    if (await sameAsRemote(bucket, file.local, file.dest)) continue;
    await putFile(
      bucket,
      file.local,
      file.dest,
      'application/vnd.apache.parquet',
    );
    sent++;
  }
  log(`  archive ${sent} of ${out.files.length} files sent`);

  let traces = 0;
  const queue = [...out.traces];
  const workers = Array.from({length: 8}, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      await putGzip(bucket, job.dest, job.csv(), 'text/csv');
      traces++;
    }
  });
  await Promise.all(workers);
  log(`  traces ${traces}`);

  if (out.band) {
    await putGzip(
      bucket,
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
          bucket,
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
  const before = await db.collection('sessions').doc(session.id).get();
  const kept = fieldAfterSync(
    session.field,
    before.exists ? before.get('field') ?? null : null,
  );
  session.field = kept.field;
  if (kept.upload) {
    await putGzip(
      bucket,
      session.field.path,
      out.fieldText,
      'application/json',
    );
  } else if (kept.field) {
    log('  field: kept the stored one');
    // Everything computed from the field is kept or worked out again from
    // the uploaded file, read once: the class lap times while they are this
    // version and this kind of session (an older analysis, a changed rule, a
    // re-typed session), and the traffic of every lap, which would otherwise
    // be written as null for want of the capture.
    let loaded;
    const load = async () =>
      (loaded ??= await readStoredField(bucket, kept.field.path, log));
    const stored = before.exists ? before.get('classLaps') ?? null : null;
    if (classLapsCurrent(stored, session.sessionType)) {
      session.classLaps = stored;
    } else {
      const field = await load();
      session.classLaps = field
        ? classLapsDoc(field, session.sessionType)
        : null;
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

  // Every document is checked first (docShape.mjs): one Firestore would refuse
  // fails this session with the field path, before anything is written.
  const writer = guardedWriter(db.bulkWriter());
  for (const rec of out.recordings)
    writer.set(db.collection('recordings').doc(rec.id), rec);
  for (const lap of out.laps)
    writer.set(db.collection('laps').doc(lap.id), lap);
  writer.set(db.collection('sessions').doc(session.id), session);
  // Merge: the track doc also holds fields other tools write (the georef,
  // centerline, edges, corner names). A new corner map replaces only its own.
  if (out.track) {
    writer.set(db.collection('tracks').doc(out.track.id), out.track, {
      merge: true,
    });
  }

  // The layout's corner boundaries, when this session changed them.
  if (out.boundaries) writeBoundaries(db, writer, out.boundaries);

  // A re-run can produce fewer laps (a file that was still growing). Drop leftovers.
  const keep = new Set(out.laps.map(lap => lap.id));
  const existing = await db
    .collection('laps')
    .where('sessionId', '==', session.id)
    .select()
    .get();
  let dropped = 0;
  for (const doc of existing.docs) {
    if (!keep.has(doc.id)) {
      writer.delete(doc.ref);
      dropped++;
    }
  }
  await writer.close();
  // Only after the session points at the new file: a phone still holding the
  // old URL gets a 404 and refetches the session.
  if (kept.deletePath) {
    await bucket.file(kept.deletePath).delete({ignoreNotFound: true});
  }
  // Slice folders of earlier syncs: everything under this session's slices
  // except the current hash.
  const [old] = await bucket.getFiles({
    prefix: `slices/${session.ownerId}/${session.id}/`,
  });
  const current = session.slices ? `${session.slices.prefix}/` : null;
  for (const f of old) {
    if (!current || !f.name.startsWith(current))
      await f.delete({ignoreNotFound: true});
  }
  log(
    `  firestore 1 session, ${out.recordings.length} recordings, ${
      out.laps.length
    } laps${dropped ? `, dropped ${dropped}` : ''}`,
  );
}
