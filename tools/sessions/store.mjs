// Write one analyzed session to Firestore and the bucket.
//
// Layout (docs/STORAGE.md):
//   gs://BUCKET/archive/{sim}/{sessionId}/{recordingId}/samples.parquet
//   gs://BUCKET/archive/{sim}/{sessionId}/{recordingId}/events.parquet
//   gs://BUCKET/traces/{ownerId}/{lapId}/v1.csv.gz
//   gs://BUCKET/bands/{ownerId}/{sessionId}/v1.json.gz
//   Firestore recordings/{recordingId}, sessions/{sessionId}, laps/{lapId},
//             tracks/{trackId} (the corner map)
import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';

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
  await bucket.upload(localPath, {
    destination: dest,
    resumable: false,
    metadata: {contentType, cacheControl: 'private, max-age=31536000'},
  });
}

async function sameAsRemote(bucket, localPath, dest) {
  try {
    const [meta] = await bucket.file(dest).getMetadata();
    const local = createHash('md5')
      .update(readFileSync(localPath))
      .digest('base64');
    return meta.md5Hash === local;
  } catch (error) {
    if (error?.code === 404) return false;
    throw error;
  }
}

async function putGzip(bucket, dest, text, contentType) {
  await bucket
    .file(dest)
    .save(gzipSync(Buffer.from(text, 'utf8'), {level: 9}), {
      resumable: false,
      metadata: {
        contentType,
        contentEncoding: 'gzip',
        cacheControl: 'private, max-age=31536000',
      },
    });
}

// A track's stored corner map, or null.
export async function getTrack(trackId) {
  const {db} = connect();
  const doc = await db.collection('tracks').doc(trackId).get();
  return doc.exists ? doc.data() : null;
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

  const writer = db.bulkWriter();
  for (const rec of out.recordings)
    writer.set(db.collection('recordings').doc(rec.id), rec);
  for (const lap of out.laps)
    writer.set(db.collection('laps').doc(lap.id), lap);
  writer.set(db.collection('sessions').doc(session.id), session);
  if (out.track) writer.set(db.collection('tracks').doc(out.track.id), out.track);

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
  log(
    `  firestore 1 session, ${out.recordings.length} recordings, ${
      out.laps.length
    } laps${dropped ? `, dropped ${dropped}` : ''}`,
  );
}
