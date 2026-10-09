import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  floorOf,
  forgetOtherOwners,
  freshState,
  LEGACY_OWNER,
  liftWindow,
  markDone,
  ownerOf,
  windowFloor,
} from './syncState.mjs';

const NOW = new Date('2026-10-08T12:00:00Z');

// What the old LapUploader left on Botkin's PC: sessions marked done, no owners.
const botkinState = () => ({
  files: {'a.duckdb': {size: 1, mtimeMs: 2}},
  sessions: {s1: 'f1', s2: 'f2', s3: 'f3'},
  revs: {s1: 4, s2: 4},
  stamps: {s1: 'x'},
});

test('a state written before owners belongs to botkin', () => {
  const state = botkinState();
  assert.equal(ownerOf(state, 's1'), LEGACY_OWNER);
  assert.equal(LEGACY_OWNER, 'botkin');
});

test('signed in as the real uid, the botkin backlog counts as new', () => {
  const state = botkinState();
  assert.equal(forgetOtherOwners(state, 'uid-9f3'), 3);
  assert.deepEqual(state.sessions, {});
  assert.deepEqual(state.revs, {});
  assert.deepEqual(state.stamps, {});
  // The described-files cache is not an upload record: it stays.
  assert.deepEqual(state.files, {'a.duckdb': {size: 1, mtimeMs: 2}});
});

test('the same owner keeps what it uploaded', () => {
  const state = botkinState();
  assert.equal(forgetOtherOwners(state, 'botkin'), 0);
  assert.deepEqual(Object.keys(state.sessions), ['s1', 's2', 's3']);
});

test('only the other owner’s sessions are forgotten', () => {
  const state = botkinState();
  markDone(state, 's2', 'f2b', 'uid-9f3');
  assert.equal(forgetOtherOwners(state, 'uid-9f3'), 2);
  assert.deepEqual(state.sessions, {s2: 'f2b'});
  assert.equal(state.revs.s2, 4);
  assert.equal(ownerOf(state, 's2'), 'uid-9f3');
});

test('markDone records the fingerprint and the owner', () => {
  const state = freshState();
  markDone(state, 's1', 'f1', 'uid-9f3');
  assert.equal(state.sessions.s1, 'f1');
  assert.equal(ownerOf(state, 's1'), 'uid-9f3');
});

test('a fresh state with a window starts 14 days back', () => {
  assert.equal(windowFloor(14, NOW), '2026-09-24');
  assert.equal(freshState({windowDays: 14, now: NOW}).since, '2026-09-24');
  assert.equal(freshState({now: NOW}).since, null);
});

test('lifting the window removes the limit', () => {
  const state = freshState({windowDays: 14, now: NOW});
  liftWindow(state);
  assert.equal(floorOf(state), null);
});

test('floorOf: the state’s own window, else the first run’s, else none', () => {
  const opts = {windowDays: 14, now: NOW};
  assert.equal(floorOf(null, opts), '2026-09-24');
  assert.equal(floorOf(null, {now: NOW}), null);
  assert.equal(floorOf(freshState(opts), opts), '2026-09-24');
  // The old uploader's state has no window, and a lifted one stays lifted.
  assert.equal(floorOf(botkinState(), opts), null);
});
