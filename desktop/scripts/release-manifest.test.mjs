import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  buildLatest,
  cargoVersionOf,
  checkVersions,
  findInstaller,
  stampVersions,
  versionOfTag,
} from './release-manifest.mjs';

test('reads the version from a tray tag and refuses other tags', () => {
  assert.equal(versionOfTag('tray-v1.2.3'), '1.2.3');
  for (const bad of ['v1.2.3', 'tray-1.2.3', 'tray-v1.2', 'tray-v1.2.3-rc1'])
    assert.throws(() => versionOfTag(bad), /not a tray-vX\.Y\.Z tag/);
});

test('the tag, tauri.conf.json and Cargo.toml must agree', () => {
  assert.equal(
    checkVersions({
      tag: 'tray-v0.2.0',
      confVersion: '0.2.0',
      cargoVersion: '0.2.0',
    }),
    '0.2.0',
  );
  assert.throws(
    () =>
      checkVersions({
        tag: 'tray-v0.2.0',
        confVersion: '0.1.0',
        cargoVersion: '0.2.0',
      }),
    /tauri\.conf\.json says 0\.1\.0/,
  );
  assert.throws(
    () =>
      checkVersions({
        tag: 'tray-v0.2.0',
        confVersion: '0.2.0',
        cargoVersion: '0.1.0',
      }),
    /Cargo\.toml says 0\.1\.0/,
  );
});

test('reads the package version from Cargo.toml, not a dependency', () => {
  const toml =
    '[package]\nname = "botracing"\nversion = "0.3.4"\n\n[dependencies]\ntauri = { version = "2" }\n';
  assert.equal(cargoVersionOf(toml), '0.3.4');
  assert.throws(() => cargoVersionOf('[package]\nname = "x"\n'), /no version/);
});

test('latest.json names the installer in Storage and carries its signature', () => {
  assert.deepEqual(
    buildLatest({
      version: '0.2.0',
      installer: 'BotRacing_0.2.0_x64-setup.exe',
      signature: 'SIG\n',
      pubDate: '2026-10-09T12:00:00.000Z',
    }),
    {
      version: '0.2.0',
      notes: '',
      pub_date: '2026-10-09T12:00:00.000Z',
      installer: 'tray/0.2.0/BotRacing_0.2.0_x64-setup.exe',
      signature: 'SIG',
    },
  );
  assert.throws(
    () =>
      buildLatest({
        version: '0.2.0',
        installer: 'x',
        signature: ' ',
        pubDate: 'd',
      }),
    /no updater signature/,
  );
});

test('finds the one installer and requires its signature beside it', () => {
  const name = 'BotRacing_0.2.0_x64-setup.exe';
  assert.equal(findInstaller([name, `${name}.sig`, 'other.txt']), name);
  assert.throws(() => findInstaller([name]), /\.sig is missing/);
  assert.throws(() => findInstaller([]), /found 0/);
});

const devFiles = () => ({
  conf: JSON.stringify({productName: 'BotRacing', version: '0.0.0-dev'}, null, 2),
  pkg: JSON.stringify({name: 'botracing-desktop', version: '0.0.0-dev'}, null, 2),
  pkgLock: JSON.stringify(
    {name: 'botracing-desktop', version: '0.0.0-dev', packages: {'': {version: '0.0.0-dev'}, 'node_modules/x': {version: '1.0.0'}}},
    null,
    2,
  ),
  cargo: '[package]\nname = "botracing"\nversion = "0.0.0-dev"\n\n[dependencies]\nserde = { version = "1" }\n',
  cargoLock:
    '[[package]]\nname = "botracing"\nversion = "0.0.0-dev"\n\n[[package]]\nname = "cargo-platform"\nversion = "0.1.9"\n',
});

test('stamp writes the release version into the five files, nothing else moves', () => {
  const out = stampVersions('0.1.11', devFiles());
  assert.equal(JSON.parse(out.conf).version, '0.1.11');
  assert.equal(JSON.parse(out.pkg).version, '0.1.11');
  const lock = JSON.parse(out.pkgLock);
  assert.equal(lock.version, '0.1.11');
  assert.equal(lock.packages[''].version, '0.1.11');
  assert.equal(lock.packages['node_modules/x'].version, '1.0.0');
  assert.equal(cargoVersionOf(out.cargo), '0.1.11');
  assert.match(out.cargo, /serde = \{ version = "1" \}/);
  assert.match(out.cargoLock, /name = "botracing"\nversion = "0.1.11"/);
  // Another crate that happens to share a version string is left alone.
  assert.match(out.cargoLock, /name = "cargo-platform"\nversion = "0.1.9"/);
});

test('stamp refuses anything but X.Y.Z, and a Cargo.lock without the app', () => {
  assert.throws(() => stampVersions('v0.1.11', devFiles()), /not an X.Y.Z/);
  assert.throws(() => stampVersions('0.1', devFiles()), /not an X.Y.Z/);
  assert.throws(
    () => stampVersions('0.1.11', {...devFiles(), cargoLock: '[[package]]\nname = "other"\nversion = "1"\n'}),
    /no botracing package/,
  );
});
