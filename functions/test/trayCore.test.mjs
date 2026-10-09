import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  MANIFEST_PATH,
  PLATFORM,
  URL_TTL_MS,
  handleTray,
  parseRelease,
} from '../src/trayCore.ts';

const enc = obj => new TextEncoder().encode(JSON.stringify(obj));

const release = {
  version: '0.2.0',
  notes: 'Faster sync',
  pub_date: '2026-10-09T12:00:00Z',
  installer: 'BotRacing_0.2.0_x64-setup.exe',
  signature: 'dW50cnVzdGVkIGNvbW1lbnQ6',
};

// A bucket with `tray/latest.json` and the installer, and a signer that
// records what it was asked.
function bucket({manifest = release, withInstaller = true} = {}) {
  const files = new Map();
  if (manifest !== null) files.set(MANIFEST_PATH, enc(manifest));
  if (manifest && withInstaller)
    files.set(
      `tray/${manifest.version}/${manifest.installer}`,
      new Uint8Array(),
    );
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

test('/latest answers in the updater format with a signed installer URL', async () => {
  const {deps, signed} = bucket();
  const out = await handleTray(deps, {method: 'GET', path: '/latest'});
  assert.equal(out.status, 200);
  assert.deepEqual(out.json, {
    version: '0.2.0',
    notes: 'Faster sync',
    pub_date: '2026-10-09T12:00:00Z',
    platforms: {
      [PLATFORM]: {
        signature: release.signature,
        url: 'https://storage.example/tray/0.2.0/BotRacing_0.2.0_x64-setup.exe?sig=abc',
      },
    },
  });
  assert.deepEqual(signed, [
    {path: 'tray/0.2.0/BotRacing_0.2.0_x64-setup.exe', ms: URL_TTL_MS},
  ]);
});

test('/download redirects to the same signed URL', async () => {
  const {deps} = bucket();
  const out = await handleTray(deps, {method: 'GET', path: '/download'});
  assert.equal(out.status, 302);
  assert.equal(
    out.location,
    'https://storage.example/tray/0.2.0/BotRacing_0.2.0_x64-setup.exe?sig=abc',
  );
});

test('no release yet: 404 for both, and nothing is signed', async () => {
  const none = bucket({manifest: null});
  for (const path of ['/latest', '/download']) {
    const out = await handleTray(none.deps, {method: 'GET', path});
    assert.equal(out.status, 404);
    assert.deepEqual(out.json, {error: 'no release yet'});
  }
  assert.equal(none.signed.length, 0);
});

test('a manifest whose installer is not in the bucket is no release yet', async () => {
  const {deps, signed} = bucket({withInstaller: false});
  const out = await handleTray(deps, {method: 'GET', path: '/latest'});
  assert.equal(out.status, 404);
  assert.equal(signed.length, 0);
});

test('a manifest of the wrong shape is a server error, not a download', async () => {
  for (const bad of [
    {...release, version: 'latest'},
    {...release, installer: '../../users/other/x.exe'},
    {...release, installer: 'setup.sh'},
    {...release, signature: ''},
    {...release, signature: 12},
  ]) {
    const {deps, signed} = bucket({manifest: bad});
    const out = await handleTray(deps, {method: 'GET', path: '/latest'});
    assert.equal(out.status, 500, JSON.stringify(bad));
    assert.equal(signed.length, 0);
  }
});

test('only GET, and only these two paths', async () => {
  const {deps} = bucket();
  assert.equal(
    (await handleTray(deps, {method: 'POST', path: '/latest'})).status,
    405,
  );
  assert.equal(
    (await handleTray(deps, {method: 'GET', path: '/code'})).status,
    404,
  );
  assert.equal(
    (await handleTray(deps, {method: 'GET', path: '/'})).status,
    404,
  );
});

test('parseRelease keeps notes and the date optional', () => {
  const r = parseRelease(
    enc({version: '1.0.0-rc.1', installer: 'a.exe', signature: 's'}),
  );
  assert.deepEqual(r, {
    version: '1.0.0-rc.1',
    notes: '',
    pubDate: null,
    installer: 'a.exe',
    signature: 's',
  });
  assert.equal(parseRelease(new TextEncoder().encode('{nope')), null);
});
