import assert from 'node:assert/strict';
import {test} from 'node:test';

import {buildLatest} from '../../scripts/android-release.mjs';
import {URL_TTL_MS} from '../src/releaseCore.ts';
import {
  ANDROID_MANIFEST_PATH,
  handleAndroid,
  parseAndroidRelease,
} from '../src/androidCore.ts';

const enc = obj => new TextEncoder().encode(JSON.stringify(obj));

// The manifest exactly as the release workflow writes it: one producer, so the
// endpoint and CI cannot drift apart (the tray's 0.1.1 bug, #361).
const release = buildLatest({
  version: '1.0.0',
  versionCode: 7,
  sha256: 'a'.repeat(64),
  certSha256: 'b'.repeat(64),
  publishedAt: '2026-10-09T20:00:00Z',
});

function bucket({manifest = release, withApk = true} = {}) {
  const files = new Map();
  if (manifest !== null) files.set(ANDROID_MANIFEST_PATH, enc(manifest));
  if (manifest && withApk) files.set(manifest.apk, new Uint8Array());
  const signed = [];
  return {
    signed,
    deps: {
      read: async p => files.get(p) ?? null,
      exists: async p => files.has(p),
      signedDownload: async (p, ms) => {
        signed.push({path: p, ms});
        return `https://storage.example/${p}?sig=abc`;
      },
    },
  };
}

test('the manifest the release script writes is the one the endpoint reads', () => {
  assert.deepEqual(parseAndroidRelease(enc(release)), {
    version: '1.0.0',
    versionCode: 7,
    apk: 'android/1.0.0/BotRacing-1.0.0.apk',
    sha256: 'a'.repeat(64),
    certSha256: 'b'.repeat(64),
    publishedAt: '2026-10-09T20:00:00Z',
  });
});

test('/latest gives the version, the versionCode and a signed URL', async () => {
  const b = bucket();
  const out = await handleAndroid(b.deps, {method: 'GET', path: '/latest'});
  assert.equal(out.status, 200);
  assert.deepEqual(out.json, {
    version: '1.0.0',
    versionCode: 7,
    sha256: 'a'.repeat(64),
    published_at: '2026-10-09T20:00:00Z',
    url: 'https://storage.example/android/1.0.0/BotRacing-1.0.0.apk?sig=abc',
  });
  assert.deepEqual(b.signed, [
    {path: 'android/1.0.0/BotRacing-1.0.0.apk', ms: URL_TTL_MS},
  ]);
});

test('/download redirects to the APK', async () => {
  const out = await handleAndroid(bucket().deps, {
    method: 'GET',
    path: '/download',
  });
  assert.equal(out.status, 302);
  assert.match(out.location, /android\/1\.0\.0\/BotRacing-1\.0\.0\.apk/);
});

test('no release yet, an APK not there yet, a bad manifest, and the wrong method or path', async () => {
  const get = (deps, path = '/latest') =>
    handleAndroid(deps, {method: 'GET', path});
  assert.equal((await get(bucket({manifest: null}).deps)).status, 404);
  assert.equal((await get(bucket({withApk: false}).deps)).status, 404);
  for (const bad of [
    {...release, versionCode: 0},
    {...release, versionCode: '7'},
    {...release, apk: 'android/0.9.0/BotRacing-1.0.0.apk'},
    {...release, apk: 'tray/1.0.0/x.apk'},
    {...release, apk: 'android/1.0.0/../x.apk'},
    {...release, apk: 'android/1.0.0/x.exe'},
    {...release, cert_sha256: 'nope'},
  ])
    assert.equal(parseAndroidRelease(enc(bad)), null, JSON.stringify(bad));
  assert.equal(
    (
      await get(
        bucket({manifest: {...release, versionCode: 0}, withApk: false}).deps,
      )
    ).status,
    500,
  );
  assert.equal(
    (await handleAndroid(bucket().deps, {method: 'POST', path: '/latest'}))
      .status,
    405,
  );
  assert.equal((await get(bucket().deps, '/other')).status, 404);
});
