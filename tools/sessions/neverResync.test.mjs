// Run: node --test tools/sessions/neverResync.test.mjs
// Once a session is uploaded, a change of analysis rules or of the curated
// track never sends it through the PC again: it reads stale, and opening it
// analyses it again in the cloud (pit-wall thread 1 #4611, apex #4613). So an
// analysis-only change needs no tray release.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analysisVersion, blockVersions} from './analyze.mjs';
import {captureExtract, readCaptureExtract} from './captureExtract.mjs';
import {freshState, markDone, uploadDue} from './syncState.mjs';
import {analysisStamp, isStale} from './versionKey.mjs';

const session = (sources, fingerprint = 'fp') => ({
  id: 's1',
  sources,
  fingerprint,
});

test('a session never uploaded is due; one uploaded with the same recordings is not', () => {
  const state = freshState();
  assert.equal(uploadDue(session('a'), state), true);
  markDone(state, 's1', 'fp', 'o', 'a');
  assert.equal(uploadDue(session('a'), state), false);
});

test('a block version bump changes the fingerprint but not the recordings: nothing is re-synced, and the session reads stale', () => {
  const state = freshState();
  markDone(state, 's1', 'fp-old-rules', 'o', 'a');
  // The new code's fingerprint differs; its recordings do not.
  assert.equal(uploadDue(session('a', 'fp-new-rules'), state), false);
  const stored = analysisStamp(analysisVersion, blockVersions);
  const bumped = {...blockVersions, pitVisit: blockVersions.pitVisit + 1};
  assert.equal(isStale(stored, analysisVersion, bumped), true);
  assert.equal(isStale(stored, analysisVersion, blockVersions), false);
});

test('a recording that grew or joined makes it due again', () => {
  const state = freshState();
  markDone(state, 's1', 'fp', 'o', 'a');
  assert.equal(uploadDue(session('a+more'), state), true);
});

test('a session uploaded before recordings were kept counts as done', () => {
  const state = freshState();
  state.sessions.s1 = 'fp-from-0.1.7';
  assert.equal(uploadDue(session('a'), state), false);
});

test("a curator's edit to the track makes a stored session stale, not due", () => {
  const stamp = {...analysisStamp(17, {t: 1}), catalog: 'm4:b3:abcd'};
  assert.equal(isStale(stamp, 17, {t: 1}, 'm4:b3:abcd'), false);
  assert.equal(isStale(stamp, 17, {t: 1}, 'm4:b4:abcd'), true);
  // A stamp from before catalogs were kept reads stale once.
  assert.equal(isStale(analysisStamp(17, {t: 1}), 17, {t: 1}, 'none'), true);
});

test('the capture extract keeps damage and race length, and nothing when the capture gave neither', () => {
  const damage = {et: [0, 0.5], dent: [2, 0], detached: [1, 0]};
  const x = captureExtract({damage, raceLength: {minutes: 40}});
  assert.deepEqual(readCaptureExtract(JSON.stringify(x)), {
    damage,
    raceLength: {minutes: 40},
  });
  assert.equal(captureExtract({damage: null, raceLength: null}), null);
  assert.equal(readCaptureExtract('{"v":99}'), null);
  assert.equal(readCaptureExtract('not json'), null);
});
