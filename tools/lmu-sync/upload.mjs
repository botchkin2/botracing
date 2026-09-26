// Upload sample_data/lmu/pack to Cloud Storage for the lmuApi function.
// Uses application-default credentials (gcloud auth application-default login
// or a service account already on this machine).

import {readdirSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require = createRequire(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../functions/package.json',
  ),
);
const admin = require('firebase-admin');

const pack = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../sample_data/lmu/pack',
);
const bucketName = process.env.LMU_BUCKET || 'botracing-61.appspot.com';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    storageBucket: bucketName,
  });
}

const bucket = admin.storage().bucket(bucketName);
const manifest = readFileSync(resolve(pack, 'manifest.json'));
await bucket.file('lmu/manifest.json').save(manifest, {
  contentType: 'application/json',
});
const laps = readdirSync(resolve(pack, 'laps')).filter(name =>
  name.endsWith('.csv'),
);
for (const name of laps) {
  const body = readFileSync(resolve(pack, 'laps', name));
  await bucket.file(`lmu/laps/${name}`).save(body, {contentType: 'text/csv'});
  console.log(`uploaded ${name} ${(body.length / 1024).toFixed(0)} KB`);
}
console.log(`${laps.length} laps -> gs://${bucketName}/lmu/`);
