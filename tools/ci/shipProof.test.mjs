import assert from 'node:assert/strict';
import {test} from 'node:test';

import {PROOF_HEADING, checkShipProof, deviceFiles, proofSection} from './shipProof.mjs';

const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OLD = '0011223344556677889900aabbccddeeff001122';
const commits = [HEAD, OLD];
const link = 'https://github.com/botchkin2/botracing/actions/runs/1/artifacts/2';
const check = (files, body) => checkShipProof({files, body, commits, head: HEAD});
const withProof = text => `Summary\n\n${PROOF_HEADING}\n${text}\n\n## Verification\nran stuff`;

test('app and tray paths reach a device; docs, tests, fixtures and web-only files do not', () => {
  const reach = p => deviceFiles([p]).map(f => f.reaches)[0] ?? null;
  for (const p of ['app/(tabs)/index.tsx', 'src/charts/Trace.tsx', 'src/setup/reanimated.native.ts', 'src/analysis/nativeSamples.ts',
    'assets/images/icon.png', 'tools/track-info/tracks.json', 'app.json', 'eas.json', 'package.json', 'package-lock.json',
    'babel.config.js', 'metro.config.js', 'fingerprint.config.js']) assert.equal(reach(p), 'app', p);
  for (const p of ['desktop/src-tauri/src/auth.rs', 'tools/uploader/watch.mjs', 'tools/sessions/sync.mjs', 'tools/capture/recorder.py', 'desktop/package.json']) {
    assert.equal(reach(p), 'tray', p);
  }
  for (const p of ['docs/API.md', 'src/charts/README.md', 'src/analysis/lap.test.ts', 'src/features/race/__fixtures__/x.json',
    'src/auth/signIn.web.ts', 'src/features/race/components/ChaseView.web.tsx', 'tools/uploader/heartbeat.test.mjs',
    'tools/capture/tests/test_writer.py', 'tools/sessions/__fixtures__/a.json', 'desktop/README.md',
    'functions/src/dataApi.ts', 'tools/dev/live.mjs', 'tools/ci/shipProof.mjs', '.github/workflows/test.yml', 'contract/payloads/a.json']) {
    assert.equal(reach(p), null, p);
  }
});

test('a docs-or-tests-only PR passes with no section', () => {
  const r = check(['docs/API.md', 'src/x/y.test.ts', 'src/a.web.tsx'], '');
  assert.equal(r.ok, true);
  assert.deepEqual(r.device, []);
});

test('an app PR with no section fails and names the file', () => {
  const r = check(['src/charts/Trace.tsx'], 'Summary only');
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /no "## Proof where he uses it" section/);
  assert.deepEqual(r.device, [{path: 'src/charts/Trace.tsx', reaches: 'app'}]);
});

test('a tray PR with link and head sha passes', () => {
  const r = check(['tools/uploader/watch.mjs'], withProof(`Rig run log: ${link} at ${HEAD.slice(0, 8)}`));
  assert.equal(r.ok, true);
  assert.deepEqual(r.notes, []);
});

test('the section needs a link and a sha of this PR, each', () => {
  const noLink = check(['app/a.tsx'], withProof(`ran at ${HEAD.slice(0, 8)}`));
  assert.equal(noLink.problems.length, 1);
  assert.match(noLink.problems[0], /no artifact link/);
  const noSha = check(['app/a.tsx'], withProof(`${link} ran on the emulator`));
  assert.match(noSha.problems[0], /names no sha/);
  const foreignSha = check(['app/a.tsx'], withProof(`${link} at deadbeef`));
  assert.match(foreignSha.problems[0], /names no sha/);
  const empty = check(['app/a.tsx'], withProof('n/a'));
  assert.equal(empty.problems.length, 2);
});

test('a proof at an older commit passes with a note to re-run it', () => {
  const r = check(['app/a.tsx'], withProof(`${link} at ${OLD.slice(0, 8)}`));
  assert.equal(r.ok, true);
  assert.match(r.notes[0], /re-run it/);
});

test('the template hint and other sections do not count as the proof', () => {
  const hinted = `<!--\n${PROOF_HEADING}\n${link} at ${HEAD}\n-->`;
  assert.equal(check(['app/a.tsx'], hinted).ok, false);
  const elsewhere = `${PROOF_HEADING}\n\n## Verification\n${link} at ${HEAD}`;
  assert.equal(check(['app/a.tsx'], elsewhere).ok, false);
  assert.equal(proofSection(null), null);
  assert.equal(proofSection(`x\r\n${PROOF_HEADING.toUpperCase()}\r\nbody`).trim(), 'body');
});

test('the files this check adds are not device code', () => {
  assert.deepEqual(deviceFiles([
    '.github/workflows/ship-proof.yml',
    '.github/pull_request_template.md',
    'tools/ci/shipProof.mjs',
    'tools/ci/shipProof.test.mjs',
  ]), []);
});
