// What CI does around an EAS build for an Android release (the android-v*
// tag workflow, pit-wall thread 1 #3270 to #3272):
//
//   node scripts/android-release.mjs check android-v1.2.0
//       the tag and app.json's expo.version say the same version
//   node scripts/android-release.mjs latest <apk> <versionCode> <certSha256> <outDir>
//       lays the release out for upload to Storage:
//         <outDir>/android/<version>/BotRacing-<version>.apk
//         <outDir>/android/latest.json   which version is current, and where
//
// latest.json is written here and only here: the function behind
// GET /api/android/latest reads it (functions/src/androidCore.ts), and its
// test builds its fixture with this file's buildLatest, so the two cannot
// drift apart (the tray's 0.1.1 lesson, #361). `versionCode` is the one EAS
// built, from the build's JSON: Settings compares on it, never on the name.
import {createHash} from 'node:crypto';
import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

/** The version in an `android-vX.Y.Z` tag, or an error naming what was wrong. */
export function versionOfTag(tag) {
  const m = /^android-v(.+)$/.exec(tag ?? '');
  if (!m || !VERSION.test(m[1]))
    throw new Error(`not an android release tag: ${tag}`);
  return m[1];
}

/** The tag and app.json agree, or an error naming both. */
export function checkVersion({tag, appVersion}) {
  const version = versionOfTag(tag);
  if (version !== appVersion)
    throw new Error(
      `${tag} says ${version} but app.json's expo.version is ${appVersion}`,
    );
  return version;
}

export const apkName = version => `BotRacing-${version}.apk`;

/**
 * The manifest the function serves: the version, EAS's versionCode, the
 * APK's object path under android/<version>/, its sha256, and the signing
 * certificate's SHA-256 the publish step verified.
 */
export function buildLatest({
  version,
  versionCode,
  sha256,
  certSha256,
  publishedAt,
}) {
  if (!VERSION.test(version)) throw new Error(`bad version: ${version}`);
  if (!Number.isInteger(versionCode) || versionCode < 1)
    throw new Error(`bad versionCode: ${versionCode}`);
  if (!SHA256.test(sha256)) throw new Error('bad sha256');
  if (!SHA256.test(certSha256)) throw new Error('bad certificate sha256');
  return {
    version,
    versionCode,
    apk: `android/${version}/${apkName(version)}`,
    sha256,
    cert_sha256: certSha256,
    published_at: publishedAt,
  };
}

function appVersion() {
  return JSON.parse(readFileSync(resolve(here, '../app.json'), 'utf8')).expo
    .version;
}

function main([cmd, ...args]) {
  if (cmd === 'check') {
    console.log(checkVersion({tag: args[0], appVersion: appVersion()}));
    return;
  }
  if (cmd === 'latest') {
    const [apk, versionCode, certSha256, outDir] = args;
    const version = appVersion();
    const bytes = readFileSync(apk);
    const latest = buildLatest({
      version,
      versionCode: Number(versionCode),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      certSha256: (certSha256 ?? '').toLowerCase().replace(/:/g, ''),
      publishedAt: new Date().toISOString(),
    });
    const dir = join(outDir, 'android', version);
    mkdirSync(dir, {recursive: true});
    copyFileSync(apk, join(dir, apkName(version)));
    writeFileSync(
      join(outDir, 'android', 'latest.json'),
      `${JSON.stringify(latest, null, 2)}\n`,
    );
    console.log(`${latest.apk} (versionCode ${latest.versionCode})`);
    return;
  }
  throw new Error(
    'usage: android-release.mjs check <tag> | latest <apk> <versionCode> <certSha256> <outDir>',
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2));
