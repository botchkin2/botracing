import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  apkName,
  buildLatest,
  checkVersion,
  versionOfTag,
} from './android-release.mjs';

const HASH = 'a'.repeat(64);
const CERT = 'b'.repeat(64);

test('a tag names the version, and must match app.json', () => {
  assert.equal(versionOfTag('android-v1.2.0'), '1.2.0');
  assert.equal(versionOfTag('android-v1.2.0-rc.1'), '1.2.0-rc.1');
  for (const bad of [
    'tray-v1.2.0',
    'android-v1.2',
    'android-1.2.0',
    '',
    undefined,
  ])
    assert.throws(() => versionOfTag(bad));
  assert.equal(
    checkVersion({tag: 'android-v1.0.0', appVersion: '1.0.0'}),
    '1.0.0',
  );
  assert.throws(
    () => checkVersion({tag: 'android-v1.0.1', appVersion: '1.0.0'}),
    /app.json's expo.version is 1.0.0/,
  );
});

test('latest.json names the APK under its own version, with what EAS built', () => {
  assert.deepEqual(
    buildLatest({
      version: '1.0.0',
      versionCode: 7,
      sha256: HASH,
      certSha256: CERT,
      publishedAt: '2026-10-09T20:00:00Z',
    }),
    {
      version: '1.0.0',
      versionCode: 7,
      apk: `android/1.0.0/${apkName('1.0.0')}`,
      sha256: HASH,
      cert_sha256: CERT,
      published_at: '2026-10-09T20:00:00Z',
    },
  );
});

test('a manifest with a bad field is never written', () => {
  const ok = {
    version: '1.0.0',
    versionCode: 7,
    sha256: HASH,
    certSha256: CERT,
    publishedAt: 'x',
  };
  for (const bad of [
    {version: '1.0'},
    {versionCode: 0},
    {versionCode: 1.5},
    {sha256: 'abc'},
    {certSha256: 'AB:CD'},
  ])
    assert.throws(() => buildLatest({...ok, ...bad}));
});
