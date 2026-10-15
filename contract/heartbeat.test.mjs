// Every real heartbeat through the server's rules, in the required job with
// no dependencies (torsion on #611): the catch-all, not only the #597 case.
// The full endpoint (storage, 429, the app's read) is functions/test/heartbeat.test.mjs.
// Run: node --test contract/
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';

import {checkHeartbeat} from '../functions/src/contract/heartbeat.ts';

import {loadPayloads, mutate, payload} from './payloads.mjs';

const semver = v => v.split('.').map(Number);
const older = (a, b) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
};

test('every real heartbeat is accepted', () => {
  const all = loadPayloads('heartbeat');
  assert.ok(all.length >= 20, `${all.length} payloads`);
  for (const {name, body} of all) {
    const r = checkHeartbeat(body);
    assert.ok(r.ok, `${name}: ${r.ok ? '' : r.error}`);
  }
});

test("both integers LMU really reported are accepted as the recorder's game version (#597)", () => {
  const recording = payload('heartbeat', '0.1.9-in-game-rec-recording');
  const [meta] = loadPayloads('capture-meta');
  for (const gameVersion of [0, meta.body.gameVersion]) {
    const r = checkHeartbeat(
      mutate(recording, 'recorder.gameVersion', gameVersion),
    );
    assert.ok(r.ok, `gameVersion ${gameVersion}: ${r.ok ? '' : r.error}`);
  }
});

test('every released tray from the oldest with payloads on has payloads', () => {
  // The list is the repo's own tray-v tags, never a hand list. A release is
  // checked one cycle late (its beats exist only once it runs; torsion
  // #5124): the release build fails when the last released tray has none.
  // A watcher run from a checkout reports its commit, not a tray version.
  const versions = new Set(
    loadPayloads('heartbeat')
      .map(p => p.body.version)
      .filter(v => /^\d+\.\d+\.\d+$/.test(v)),
  );
  const oldest = [...versions].sort((a, b) => (older(a, b) ? -1 : 1))[0];
  const tags = execFileSync('git', ['tag', '--list', 'tray-v*'], {
    encoding: 'utf8',
  })
    .split('\n')
    .map(t => t.trim().replace(/^tray-v/, ''))
    .filter(v => /^\d+\.\d+\.\d+$/.test(v));
  assert.ok(tags.length > 0, 'no tray-v tags: fetch them (fetch-depth: 0)');
  // Not the newest tag: its beats reach the repo in a PR after its release,
  // and until then every open PR would be red (torsion on #611).
  const newest = [...tags].sort((a, b) => (older(a, b) ? -1 : 1)).at(-1);
  const missing = tags.filter(
    v => v !== newest && !older(v, oldest) && !versions.has(v),
  );
  assert.deepEqual(
    missing,
    [],
    'save a real beat of each in contract/payloads/heartbeat',
  );
});

test('a real beat with a tray update waiting is accepted; a non-string or over-long version is refused', () => {
  const real = payload('heartbeat', '0.1.12-update-waiting-rec-none');
  assert.equal(real.updateWaiting, '0.1.13');
  const ok = checkHeartbeat(real);
  assert.ok(ok.ok, ok.ok ? '' : ok.error);
  assert.equal(ok.doc.updateWaiting, '0.1.13');
  assert.equal(checkHeartbeat(mutate(real, 'updateWaiting', 12)).ok, false);
  assert.equal(checkHeartbeat(mutate(real, 'updateWaiting', 'x'.repeat(33))).ok, false);
});
