// What CI does around an EAS build for an Android release
// (.github/workflows/android-release.yml, pit-wall thread 1 #3270 to #3272):
//
//   node scripts/android-release.mjs check android-v1.2.0
//       the tag and app.json's expo.version say the same version
//   node scripts/android-release.mjs build <eas-build.json> android-v1.2.0
//       the finished build EAS reported: prints id=, versionCode= and url=
//       lines for $GITHUB_OUTPUT
//   node scripts/android-release.mjs verify <apk> <versionCode>
//       the APK is signed by the pinned key (scripts/android-signer.json) and
//       is this package, version and versionCode; prints the cert's SHA-256
//   node scripts/android-release.mjs latest <apk> <versionCode> <outDir>
//       verifies as above, then lays the release out for upload to Storage:
//         <outDir>/android/<version>/BotRacing-<version>.apk
//         <outDir>/android/latest.json   which version is current, and where
//
// latest.json is written here and only here: the function behind
// GET /api/android/latest reads it (functions/src/androidCore.ts), and its
// test builds its fixture with this file's buildLatest, so the two cannot
// drift apart (the tray's 0.1.1 lesson, #361). `versionCode` is the one EAS
// built, from the build's JSON, and the APK must say the same: Settings
// compares on it, never on the name.
//
// The signer is checked, not just a hash (rake #3272): an APK signed by any
// key but the pinned one never reaches Settings, since the installed app
// could not update over it anyway. verify and latest run apksigner and aapt2
// from the newest build-tools under $ANDROID_HOME (CI's runner has them).
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
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

const positiveInt = v => Number.isInteger(v) && v >= 1;

/**
 * The one finished Android build in `eas build --json` output (an array of
 * builds), for this version: {id, versionCode, url}. Anything else (an error,
 * a build that did not finish, another version, no APK URL) is an error.
 */
export function parseBuild(json, version) {
  const builds = Array.isArray(json) ? json : [json];
  if (builds.length !== 1)
    throw new Error(`expected one build, EAS reported ${builds.length}`);
  const b = builds[0] ?? {};
  if (b.platform !== 'ANDROID')
    throw new Error(`not an Android build: ${b.platform}`);
  if (b.status !== 'FINISHED')
    throw new Error(`build ${b.id} ended ${b.status}, not FINISHED`);
  if (b.appVersion !== version)
    throw new Error(`build ${b.id} is version ${b.appVersion}, not ${version}`);
  const versionCode = Number(b.appBuildVersion);
  if (!positiveInt(versionCode))
    throw new Error(`build ${b.id} has no versionCode (${b.appBuildVersion})`);
  const url = b.artifacts?.applicationArchiveUrl ?? b.artifacts?.buildUrl;
  if (typeof url !== 'string' || !url.startsWith('https://'))
    throw new Error(`build ${b.id} has no APK URL`);
  return {id: b.id, versionCode, url};
}

/** The one signer's certificate SHA-256 in `apksigner verify --print-certs` output. */
export function signerOf(apksignerOutput) {
  const text = String(apksignerOutput);
  // 'Signer #1 ...', or 'Signer (minSdkVersion=24, ...) ...' when signers differ by
  // SDK range; the same certificate may be listed once per range.
  const certs = [
    ...new Set(
      [
        ...text.matchAll(
          /^Signer [^\r\n]*? certificate SHA-256 digest: ([0-9a-fA-F:]+)\s*$/gm,
        ),
      ].map(m => m[1].toLowerCase().replace(/:/g, '')),
    ),
  ];
  if (certs.length !== 1)
    throw new Error(
      `expected one signer, apksigner printed ${certs.length}: ${JSON.stringify(
        text.slice(0, 400),
      )}`,
    );
  if (!SHA256.test(certs[0])) throw new Error('bad certificate digest');
  return certs[0];
}

/** {package, versionCode, versionName} from `aapt2 dump badging`. */
export function badgingOf(aaptOutput) {
  const line = /^package: (.*)$/m.exec(String(aaptOutput))?.[1] ?? '';
  const field = name => new RegExp(`\\b${name}='([^']*)'`).exec(line)?.[1];
  return {
    package: field('name'),
    versionCode: Number(field('versionCode')),
    versionName: field('versionName'),
  };
}

/**
 * The APK is what this release says it is: signed by the pinned key, for the
 * pinned package, at this version and the versionCode EAS reported. Returns
 * the cert's SHA-256. With nothing pinned yet it fails and prints the cert to
 * pin (the first build; committing the pin is reviewed).
 */
export function checkApk({cert, badging, pin, version, versionCode}) {
  if (!SHA256.test(pin.certSha256 ?? ''))
    throw new Error(
      `no signing certificate is pinned. This APK's is ${cert}: if it is the ` +
        'release key (eas credentials -p android), pin it in scripts/android-signer.json in a PR',
    );
  if (cert !== pin.certSha256)
    throw new Error(
      `the APK is signed by ${cert}, not the pinned release key ${pin.certSha256}`,
    );
  if (badging.package !== pin.package)
    throw new Error(`the APK is ${badging.package}, not ${pin.package}`);
  if (badging.versionName !== version)
    throw new Error(
      `the APK is version ${badging.versionName}, not ${version}`,
    );
  if (badging.versionCode !== versionCode)
    throw new Error(
      `the APK's versionCode is ${badging.versionCode}, EAS reported ${versionCode}`,
    );
  return cert;
}

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
  if (!positiveInt(versionCode))
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

const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const appVersion = () => readJson(resolve(here, '../app.json')).expo.version;
const pinned = () => readJson(resolve(here, 'android-signer.json'));

/** A tool from the newest build-tools under $ANDROID_HOME. */
function buildTool(name) {
  const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!home) throw new Error('ANDROID_HOME is not set (apksigner, aapt2)');
  const dir = join(home, 'build-tools');
  const newest = readdirSync(dir)
    .filter(v => existsSync(join(dir, v, name)))
    .sort((a, b) => a.localeCompare(b, 'en', {numeric: true}))
    .at(-1);
  if (!newest) throw new Error(`no ${name} under ${dir}`);
  return join(dir, newest, name);
}

const run = (tool, args) =>
  execFileSync(buildTool(tool), args, {encoding: 'utf8'});

function verify(apk, versionCode) {
  return checkApk({
    cert: signerOf(run('apksigner', ['verify', '--print-certs', apk])),
    badging: badgingOf(run('aapt2', ['dump', 'badging', apk])),
    pin: pinned(),
    version: appVersion(),
    versionCode,
  });
}

function main([cmd, ...args]) {
  if (cmd === 'check') {
    console.log(checkVersion({tag: args[0], appVersion: appVersion()}));
    return;
  }
  if (cmd === 'build') {
    const [file, tag] = args;
    const b = parseBuild(
      readJson(file),
      checkVersion({tag, appVersion: appVersion()}),
    );
    console.log(`id=${b.id}\nversionCode=${b.versionCode}\nurl=${b.url}`);
    return;
  }
  if (cmd === 'verify') {
    console.log(verify(args[0], Number(args[1])));
    return;
  }
  if (cmd === 'latest') {
    const [apk, versionCode, outDir] = args;
    const certSha256 = verify(apk, Number(versionCode));
    const version = appVersion();
    const latest = buildLatest({
      version,
      versionCode: Number(versionCode),
      sha256: createHash('sha256').update(readFileSync(apk)).digest('hex'),
      certSha256,
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
    'usage: android-release.mjs check <tag> | build <eas.json> <tag> | ' +
      'verify <apk> <versionCode> | latest <apk> <versionCode> <outDir>',
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2));
