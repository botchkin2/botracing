import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  buildLatest,
  cargoVersionOf,
  checkVersions,
  findInstaller,
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
