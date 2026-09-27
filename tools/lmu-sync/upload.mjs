// Copy the local lap pack to Cloud Storage. Safe to re-run.
//
//   node tools/lmu-sync/upload.mjs
//
// Auth, first match wins:
//   GOOGLE_APPLICATION_CREDENTIALS  path to a service-account json
//   gcloud application-default credentials
//
// The manifest is uploaded after the lap files, so the site never lists a lap
// whose CSV is still missing. A stint already uploaded is skipped unless the
// local file changed.

import {createHash} from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {sinceDay, tooOld} from './window.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const pack = resolve(repoRoot, 'sample_data/lmu/pack');
const ledgerPath = resolve(repoRoot, 'sample_data/lmu/uploaded.json');
const bucketName = process.env.LMU_BUCKET || 'botracing-61-lmu';

const require = createRequire(resolve(repoRoot, 'functions/package.json'));
const admin = require('firebase-admin');

function loadLedger() {
  if (!existsSync(ledgerPath)) return {};
  return JSON.parse(readFileSync(ledgerPath, 'utf8'));
}

function fileHash(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

function explainAuth() {
  const adc = resolve(
    process.env.APPDATA || '',
    'gcloud/application_default_credentials.json',
  );
  console.error(
    [
      'No Google Cloud credentials on this PC.',
      'Either set GOOGLE_APPLICATION_CREDENTIALS to a service-account json for botracing-61,',
      'or install the Google Cloud SDK and run:',
      '  gcloud auth application-default login',
      `Looked for ${process.env.GOOGLE_APPLICATION_CREDENTIALS || adc}`,
    ].join('\n'),
  );
}

if (!existsSync(resolve(pack, 'manifest.json'))) {
  console.error(`No pack yet at ${pack}`);
  process.exit(1);
}

let credential;
try {
  credential = admin.credential.applicationDefault();
} catch (error) {
  explainAuth();
  console.error(error.message);
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({credential, storageBucket: bucketName});
}

const bucket = admin.storage().bucket(bucketName);
const since = sinceDay();
const manifestPath = resolve(pack, 'manifest.json');
const allLaps = JSON.parse(readFileSync(manifestPath, 'utf8'));
const manifest = [];
const staleLaps = [];
for (const lap of allLaps) {
  if (tooOld(lap.event || lap.id, since)) staleLaps.push(lap);
  else manifest.push(lap);
}
const ledger = loadLedger();
mkdirSync(dirname(ledgerPath), {recursive: true});

let uploaded = 0;
let skipped = 0;
let missing = 0;
for (const lap of manifest) {
  if (!existsSync(resolve(pack, 'laps', `${lap.id}.csv`))) {
    missing++;
    console.error(`missing local csv for ${lap.id}`);
  }
}
if (missing > 0) {
  console.error(
    `${missing} lap file(s) missing. Nothing was deleted or uploaded.`,
  );
  process.exit(1);
}

let remoteFiles = [];
try {
  [remoteFiles] = await bucket.getFiles({prefix: 'lmu/laps/'});
} catch (error) {
  const message = String(error.message || error);
  if (message.includes('default credentials')) {
    explainAuth();
    process.exit(1);
  }
  if (message.includes('bucket does not exist')) {
    console.error(
      `Bucket gs://${bucketName} does not exist. Create it in project botracing-61, or set LMU_BUCKET.`,
    );
    process.exit(1);
  }
  throw error;
}

for (const lap of manifest) {
  const name = `${lap.id}.csv`;
  const localPath = resolve(pack, 'laps', name);
  const info = statSync(localPath);
  const hash = await fileHash(localPath);
  const remoteName = `lmu/laps/${name}`;
  if (ledger[remoteName] === hash) {
    skipped++;
    continue;
  }
  try {
    await bucket.upload(localPath, {
      destination: remoteName,
      metadata: {contentType: 'text/csv', metadata: {sha256: hash}},
    });
  } catch (error) {
    const message = String(error.message || error);
    if (message.includes('default credentials')) {
      explainAuth();
      process.exit(1);
    }
    if (message.includes('bucket does not exist')) {
      console.error(
        `Bucket gs://${bucketName} does not exist. Create it in project botracing-61, or set LMU_BUCKET.`,
      );
      process.exit(1);
    }
    throw error;
  }
  ledger[remoteName] = hash;
  writeFileSync(ledgerPath, JSON.stringify(ledger));
  uploaded++;
  console.log(
    `uploaded ${name} ${(info.size / 1024).toFixed(0)} KB (${uploaded} new, ${skipped} skipped)`,
  );
}

if (staleLaps.length > 0) {
  for (const lap of staleLaps) {
    const stale = resolve(pack, 'laps', `${lap.id}.csv`);
    if (existsSync(stale)) unlinkSync(stale);
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`dropped ${staleLaps.length} laps older than ${since}`);
}

const manifestHash = await fileHash(manifestPath);
if (ledger['lmu/manifest.json'] !== manifestHash) {
  await bucket.upload(manifestPath, {
    destination: 'lmu/manifest.json',
    metadata: {contentType: 'application/json', metadata: {sha256: manifestHash}},
  });
  ledger['lmu/manifest.json'] = manifestHash;
  writeFileSync(ledgerPath, JSON.stringify(ledger));
  console.log(`uploaded manifest ${manifest.length} laps`);
} else {
  console.log(`manifest unchanged, ${manifest.length} laps`);
}

let removedRemote = 0;
for (const remote of remoteFiles) {
  const id = remote.name.split('/').pop().replace(/\.csv$/, '');
  if (!tooOld(id, since)) continue;
  await remote.delete();
  delete ledger[`lmu/laps/${id}.csv`];
  removedRemote++;
}
if (removedRemote > 0) {
  writeFileSync(ledgerPath, JSON.stringify(ledger));
  console.log(`removed ${removedRemote} remote laps older than ${since}`);
}

console.log(
  `gs://${bucketName}/lmu/  uploaded=${uploaded} skipped=${skipped}`,
);
