// The golden slices live in the private bucket (the repo is public and they are
// real laps): `golden/<name>/<file>` under the manifest's `bucket`, each file's
// sha256 pinned in tools/golden/manifest.json. A run fetches only what is not
// already in the cache with the right sha256, and refuses a file that does not
// match: a changed slice is a change to the manifest, in a PR.
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const CACHE = resolve(here, '.golden', 'cache');

const gcloud = (args, opts = {}) =>
  spawnSync('gcloud', args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...opts,
  });

const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');

/** True when `dir` holds every file of `fixtures` with the pinned sha256. */
export function intact(dir, fixtures) {
  return Object.entries(fixtures).every(
    ([file, f]) => existsSync(resolve(dir, file)) && sha256(resolve(dir, file)) === f.sha256,
  );
}

/** Copies a made slice to the bucket (needs write access: the curator's own gcloud login). */
export function putFixtures(name, dir, bucket) {
  const files = readdirSync(dir).map(f => resolve(dir, f));
  const r = gcloud(['storage', 'cp', ...files, `${bucket}/${name}/`]);
  if (r.status !== 0) throw new Error(`upload of ${name} failed: ${String(r.stderr).split('\n')[0]}`);
}

/**
 * The directory holding the slice, fetched if need be, or {skip: reason} when
 * it cannot be (no gcloud, no credential: a fork's pull request). Never a
 * partial or mismatching slice.
 */
export function ensureFixtures(name, manifest, {cache = CACHE} = {}) {
  const fixtures = manifest.fixtures[name];
  if (!fixtures) return {skip: `${name} has no pinned fixtures in the manifest`};
  const dir = resolve(cache, name);
  if (intact(dir, fixtures)) return {dir};
  mkdirSync(dir, {recursive: true});
  // Each file by the name the manifest pins, not a wildcard: the CI reader may
  // get objects under golden/ but not list them (ops/iam/goldenReaderPlan.mjs).
  const r = gcloud([
    'storage',
    'cp',
    ...Object.keys(fixtures).map(file => `${manifest.bucket}/${name}/${file}`),
    dir + sep,
  ]);
  if (r.error || r.status !== 0)
    return {skip: `could not fetch ${name} from the bucket (${String(r.stderr || r.error?.message || '').split('\n')[0]})`};
  if (!intact(dir, fixtures))
    throw new Error(`${name}: the fetched files do not match the sha256 pinned in the manifest`);
  return {dir};
}
