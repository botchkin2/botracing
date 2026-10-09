// What CI does around `tauri build` for a tray release (.github/workflows/tray-release.yml):
//
//   node desktop/scripts/release-manifest.mjs check tray-v0.1.1
//       the tag, tauri.conf.json and Cargo.toml all say the same version
//   node desktop/scripts/release-manifest.mjs build <outDir>
//       lays the build out for upload to Storage:
//         <outDir>/tray/<version>/<installer>-setup.exe   the NSIS installer
//         <outDir>/tray/<version>/<installer>-setup.exe.sig   its updater signature
//         <outDir>/tray/latest.json     which version is current, and where
//
// `latest.json` is not the updater's own format: the function behind
// `GET /api/tray/latest` reads it, signs a short-lived download URL for
// `installer`, and answers the Tauri updater with {version, notes, pub_date,
// url, signature}. The signature is Tauri's (ed25519, the key held only as an
// Actions secret); it is not code signing.
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tauriDir = resolve(here, '../src-tauri');

/** The version in a `tray-vX.Y.Z` tag, or an error naming what was wrong. */
export function versionOfTag(tag) {
  const match = /^tray-v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match) throw new Error(`"${tag}" is not a tray-vX.Y.Z tag`);
  return match[1];
}

/** Throws unless the tag, tauri.conf.json and Cargo.toml agree. */
export function checkVersions({tag, confVersion, cargoVersion}) {
  const version = versionOfTag(tag);
  if (confVersion !== version)
    throw new Error(
      `tauri.conf.json says ${confVersion}, the tag says ${version}`,
    );
  if (cargoVersion !== version)
    throw new Error(`Cargo.toml says ${cargoVersion}, the tag says ${version}`);
  return version;
}

export function cargoVersionOf(cargoToml) {
  const match = /^\s*version\s*=\s*"([^"]+)"/m.exec(cargoToml);
  if (!match) throw new Error('Cargo.toml has no version');
  return match[1];
}

/** latest.json: the version, where its installer is in Storage, and its signature. */
export function buildLatest({
  version,
  installer,
  signature,
  pubDate,
  notes = '',
}) {
  if (!signature.trim())
    throw new Error('the installer has no updater signature');
  return {
    version,
    notes,
    pub_date: pubDate,
    installer: `tray/${version}/${installer}`,
    signature: signature.trim(),
  };
}

/** The NSIS installer and its .sig in a bundle folder. */
export function findInstaller(files) {
  const installers = files.filter(f => f.endsWith('-setup.exe'));
  if (installers.length !== 1)
    throw new Error(`expected one -setup.exe, found ${installers.length}`);
  const installer = installers[0];
  if (!files.includes(`${installer}.sig`))
    throw new Error(`${installer}.sig is missing (is the updater key set?)`);
  return installer;
}

function readVersions() {
  const conf = JSON.parse(
    readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8'),
  );
  const cargo = readFileSync(join(tauriDir, 'Cargo.toml'), 'utf8');
  return {confVersion: conf.version, cargoVersion: cargoVersionOf(cargo)};
}

function build(outDir) {
  const {confVersion} = readVersions();
  const bundle = join(tauriDir, 'target/release/bundle/nsis');
  const installer = findInstaller(readdirSync(bundle));
  const to = join(outDir, 'tray', confVersion);
  mkdirSync(to, {recursive: true});
  copyFileSync(join(bundle, installer), join(to, installer));
  copyFileSync(join(bundle, `${installer}.sig`), join(to, `${installer}.sig`));
  const latest = buildLatest({
    version: confVersion,
    installer,
    signature: readFileSync(join(bundle, `${installer}.sig`), 'utf8'),
    pubDate: new Date().toISOString(),
  });
  writeFileSync(
    join(outDir, 'tray', 'latest.json'),
    `${JSON.stringify(latest, null, 2)}\n`,
  );
  console.log(`laid out ${installer} ${confVersion} in ${outDir}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command, arg] = process.argv.slice(2);
  try {
    if (command === 'check') {
      const version = checkVersions({tag: arg, ...readVersions()});
      console.log(`tag, tauri.conf.json and Cargo.toml agree on ${version}`);
    } else if (command === 'build' && arg) {
      build(arg);
    } else {
      throw new Error(
        'usage: release-manifest.mjs check <tag> | build <outDir>',
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
