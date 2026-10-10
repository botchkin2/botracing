import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

import {
  apkName,
  badgingOf,
  buildLatest,
  checkApk,
  checkVersion,
  parseBuild,
  signerOf,
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

// `eas build --json --wait` output, trimmed to the fields read.
const easBuild = over => [
  {
    id: 'b1',
    platform: 'ANDROID',
    status: 'FINISHED',
    appVersion: '1.0.0',
    appBuildVersion: '7',
    artifacts: {
      buildUrl: 'https://expo.dev/artifacts/eas/x.apk',
      applicationArchiveUrl: 'https://expo.dev/artifacts/eas/x.apk',
    },
    ...over,
  },
];

test('the build EAS reports gives its id, versionCode and APK URL', () => {
  assert.deepEqual(parseBuild(easBuild(), '1.0.0'), {
    id: 'b1',
    versionCode: 7,
    url: 'https://expo.dev/artifacts/eas/x.apk',
  });
  for (const bad of [
    {status: 'ERRORED'},
    {status: 'CANCELED'},
    {platform: 'IOS'},
    {appVersion: '0.9.0'},
    {appBuildVersion: undefined},
    {appBuildVersion: '0'},
    {artifacts: {}},
    {artifacts: {buildUrl: 'http://x.apk'}},
  ])
    assert.throws(
      () => parseBuild(easBuild(bad), '1.0.0'),
      JSON.stringify(bad),
    );
  assert.throws(() => parseBuild([], '1.0.0'), /one build/);
  assert.throws(() => parseBuild([...easBuild(), ...easBuild()], '1.0.0'));
});

// What apksigner verify --print-certs and aapt2 dump badging print.
const signer = (cert, n = 1) => `Signer #${n} certificate DN: CN=Android, O=Expo
Signer #${n} certificate SHA-256 digest: ${cert}
Signer #${n} certificate SHA-1 digest: ${'c'.repeat(40)}
Signer #${n} certificate MD5 digest: ${'d'.repeat(32)}
`;
const badging = (code = 7, name = '1.0.0', pkg = 'app.botracing.android') =>
  `package: name='${pkg}' versionCode='${code}' versionName='${name}' platformBuildVersionName='15'
sdkVersion:'24'
application-label:'botracing-61'
`;
const PIN = {package: 'app.botracing.android', certSha256: CERT};
const apk = over => ({
  cert: CERT,
  badging: badgingOf(badging()),
  pin: PIN,
  version: '1.0.0',
  versionCode: 7,
  ...over,
});

test('the signer and the badging are read from the tools output', () => {
  assert.equal(signerOf(signer(CERT)), CERT);
  assert.equal(signerOf(signer(`${'AB:'.repeat(31)}AB`)), 'ab'.repeat(32));
  assert.throws(() => signerOf(''), /one signer/);
  assert.throws(() => signerOf(signer(CERT) + signer(HASH, 2)), /one signer/);
  // apksigner 36.0.0 (Windows, CRLF line ends), a real run: android-release.mjs reads it unchanged.
  assert.equal(
    signerOf(
      readFileSync(
        new URL('./__fixtures__/apksigner-print-certs.txt', import.meta.url),
        'utf8',
      ),
    ),
    '3240a6b76e94c99043b930c3b848efebbd064411ac779cc0fc4d1436749cf670',
  );
  // One certificate listed once per SDK range is still one signer.
  const ranged = ['24', '33']
    .map(
      (min, i) => `Signer (minSdkVersion=${min}, maxSdkVersion=${
        i ? 2147483647 : 32
      }) certificate SHA-256 digest: ${CERT}
`,
    )
    .join('');
  assert.equal(signerOf(ranged), CERT);
  assert.throws(() => signerOf('WARNING: something'), /printed 0: "WARNING/);
  assert.deepEqual(badgingOf(badging()), {
    package: 'app.botracing.android',
    versionCode: 7,
    versionName: '1.0.0',
  });
});

test('only an APK signed by the pinned key, for this package, version and versionCode passes', () => {
  assert.equal(checkApk(apk()), CERT);
  assert.throws(
    () => checkApk(apk({cert: HASH})),
    /not the pinned release key/,
  );
  assert.throws(
    () => checkApk(apk({pin: {...PIN, certSha256: ''}})),
    new RegExp(`This APK's is ${CERT}`),
  );
  assert.throws(
    () => checkApk(apk({badging: badgingOf(badging(7, '1.0.0', 'com.x'))})),
    /com\.x/,
  );
  assert.throws(
    () => checkApk(apk({badging: badgingOf(badging(7, '0.9.0'))})),
    /version 0\.9\.0/,
  );
  assert.throws(
    () => checkApk(apk({badging: badgingOf(badging(6))})),
    /EAS reported 7/,
  );
});

test('the pin names the package app.json builds', () => {
  const read = f =>
    JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
  assert.equal(
    read('./android-signer.json').package,
    read('../app.json').expo.android.package,
  );
});
