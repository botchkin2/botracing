// Put reviewed track fits into the store. Manual, like sync; never in CI.
//
//   node tools/track-fit/seed.mjs            # dry run: print what would change
//   node tools/track-fit/seed.mjs --write    # merge onto tracks/{trackId}, upload outlines
//
// Reads georef.json (checked in) and out/{trackId}.geojson (made by fit.py).
// Touches only georef, quality, qualityNote and trackMap on the track doc,
// with {merge: true}, so the corner map written by sync survives.
//   gs://BUCKET/trackmaps/{trackId}/v1.geojson.gz
import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {connect} from '../sessions/store.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const write = process.argv.includes('--write');
const fits = JSON.parse(readFileSync(resolve(here, 'georef.json'), 'utf8'));

const {db, bucket} = write ? connect() : {};
for (const [trackId, fit] of Object.entries(fits)) {
  const local = resolve(here, 'out', `${trackId}.geojson`);
  const path = `trackmaps/${trackId}/v1.geojson.gz`;
  const hasOutline = existsSync(local);
  console.log(
    `${write ? 'write' : 'would write'} ${trackId}: ${fit.quality}, median ${fit.georef.fitMedianM} m` +
      (hasOutline ? `, outline -> ${path}` : ', no outline (run fit.py)'),
  );
  if (!write) continue;
  if (hasOutline) {
    await bucket.file(path).save(gzipSync(readFileSync(local), {level: 9}), {
      resumable: false,
      metadata: {contentType: 'application/geo+json', contentEncoding: 'gzip', cacheControl: 'private, max-age=86400'},
    });
  }
  await db
    .collection('tracks')
    .doc(trackId)
    .set(
      {
        georef: fit.georef,
        quality: fit.quality,
        qualityNote: fit.qualityNote,
        ...(hasOutline && {trackMap: {path, attribution: '© OpenStreetMap contributors, ODbL 1.0'}}),
      },
      {merge: true},
    );
}
if (!write) console.log('\nDry run. Add --write to apply.');
