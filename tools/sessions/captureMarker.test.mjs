import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {
  MARKER,
  capturesRead,
  liveMarks,
  dropSessionIds,
  foreignMissing,
  markUploaded,
  markVerified,
  unverifiedMarks,
} from './captureMarker.mjs';

const capture = (root, name) => {
  mkdirSync(resolve(root, name), {recursive: true});
  writeFileSync(resolve(root, name, 'meta.json'), '{}');
};

test('marks the captures a session used, and only those', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'marker-'));
  capture(root, 'a');
  capture(root, 'b');
  const marked = markUploaded(root, ['a'], 's1', {
    now: new Date('2026-10-09T15:00:00Z'),
  });
  assert.deepEqual(marked, ['a']);
  assert.deepEqual(
    JSON.parse(readFileSync(resolve(root, 'a', MARKER), 'utf8')),
    {
      sessionId: 's1',
      sessionIds: ['s1'],
      uploadedUtc: '2026-10-09T15:00:00.000Z',
      verified: {},
    },
  );
  assert.ok(!readdirSync(resolve(root, 'b')).includes(MARKER));
  assert.ok(!readdirSync(resolve(root, 'a')).some(f => f.endsWith('.tmp')));
  rmSync(root, {recursive: true, force: true});
});

test('a capture that is gone, and no captures at all, are skipped quietly', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'marker-'));
  assert.deepEqual(markUploaded(root, ['pruned'], 's1'), []);
  assert.deepEqual(markUploaded(root, undefined, 's1'), []);
  assert.deepEqual(markUploaded(resolve(root, 'nope'), ['x'], 's1'), []);
  rmSync(root, {recursive: true, force: true});
});

test('a second session using the same capture is added to the marker', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'marker-'));
  capture(root, 'a');
  markUploaded(root, ['a'], 's1', {now: new Date('2026-10-09T15:00:00Z')});
  markUploaded(root, ['a'], 's2', {now: new Date('2026-10-09T16:00:00Z')});
  const marker = JSON.parse(readFileSync(resolve(root, 'a', MARKER), 'utf8'));
  assert.equal(marker.sessionId, 's2');
  // Every session that used the capture, so "all uploaded" can be checked.
  assert.deepEqual(marker.sessionIds, ['s1', 's2']);
  markUploaded(root, ['a'], 's2');
  assert.deepEqual(
    JSON.parse(readFileSync(resolve(root, 'a', MARKER), 'utf8')).sessionIds,
    ['s1', 's2'],
  );
  rmSync(root, {recursive: true, force: true});
});

test('a session reads the captures of its own sim, track and time', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'marker-'));
  const meta = (name, m, files) => {
    const dir = resolve(root, name);
    mkdirSync(dir, {recursive: true});
    writeFileSync(resolve(dir, 'meta.json'), JSON.stringify(m));
    for (const f of files) writeFileSync(resolve(dir, f), '');
  };
  const when = {
    startUtc: '2026-10-09T14:00:00.000Z',
    endUtc: '2026-10-09T14:10:00.000Z',
  };
  meta('lmu-sebring', {track: 'Sebring', ...when}, ['field-0000.parquet']);
  meta('ir-sebring', {sim: 'iracing', track: 'Sebring', ...when}, [
    'player-0000.parquet',
  ]);
  meta('ir-monza', {sim: 'iracing', track: 'Monza', ...when}, [
    'player-0000.parquet',
  ]);
  const span = {
    tracks: ['Sebring', 'layout'],
    startMs: Date.parse('2026-10-09T14:02:00Z'),
    endMs: Date.parse('2026-10-09T14:05:00Z'),
  };
  assert.deepEqual(capturesRead(root, 'iracing', span), ['ir-sebring']);
  assert.deepEqual(capturesRead(root, 'lmu', span), ['lmu-sebring']);
  rmSync(root, {recursive: true, force: true});
});

test('a read-back that passed is recorded; one that failed later removes it, so the capture is kept', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'marker-'));
  capture(root, 'a');
  const read = () =>
    JSON.parse(readFileSync(resolve(root, 'a', MARKER), 'utf8')).verified;
  const now = new Date('2026-10-22T04:00:00Z');
  markUploaded(root, ['a'], 's1', {
    check: {ok: true, sessionId: 's1', laps: 31, fieldHash: 'abc123'},
    now,
  });
  assert.deepEqual(read(), {
    s1: {laps: 31, fieldHash: 'abc123', utc: '2026-10-22T04:00:00.000Z'},
  });
  // A second session on the same capture, not verified: s1 stays, s2 absent.
  markUploaded(root, ['a'], 's2', {check: {ok: false, reason: 'no field'}});
  assert.deepEqual(Object.keys(read()), ['s1']);
  // s1 re-uploaded and its read-back failed: it is no longer verified.
  markUploaded(root, ['a'], 's1', {check: {ok: false, reason: 'laps'}});
  assert.deepEqual(read(), {});
  rmSync(root, {recursive: true, force: true});
});

test('a marker from before the read-back is listed, then verified in place', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'marker-'));
  capture(root, 'old');
  capture(root, 'none');
  writeFileSync(
    resolve(root, 'old', MARKER),
    JSON.stringify({
      sessionId: 's2',
      sessionIds: ['s1', 's2'],
      uploadedUtc: '2026-10-01T00:00:00.000Z',
    }),
  );
  assert.deepEqual(unverifiedMarks(root), [
    {name: 'old', sessionIds: ['s1', 's2']},
  ]);
  const now = new Date('2026-10-22T05:00:00Z');
  assert.equal(markVerified(root, 'old', 's1', {ok: false}, now), false);
  assert.equal(
    markVerified(root, 'old', 's1', {ok: true, laps: 4, fieldHash: 'f'}, now),
    true,
  );
  assert.deepEqual(unverifiedMarks(root), [{name: 'old', sessionIds: ['s2']}]);
  const marker = JSON.parse(readFileSync(resolve(root, 'old', MARKER), 'utf8'));
  assert.equal(marker.uploadedUtc, '2026-10-01T00:00:00.000Z');
  assert.deepEqual(marker.verified.s1, {
    laps: 4,
    fieldHash: 'f',
    utc: '2026-10-22T05:00:00.000Z',
  });
  rmSync(root, {recursive: true, force: true});
});

test('a capture live laps uploaded is listed until its sessions are verified', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'marker-'));
  capture(root, 'race');
  const index = {
    'race#0': {sessionId: 'L1'},
    'race#1': {sessionId: 'L1'},
    'race#2': {sessionId: 'L2'},
    'gone#0': {sessionId: 'L3'},
  };
  assert.deepEqual(liveMarks(root, index), [
    {name: 'race', sessionIds: ['L1', 'L2']},
  ]);
  markUploaded(root, ['race'], 'L1', {
    check: {ok: true, laps: 31, fieldHash: 'f'},
  });
  assert.deepEqual(liveMarks(root, index), [
    {name: 'race', sessionIds: ['L2']},
  ]);
  assert.deepEqual(liveMarks(root, undefined), []);
  rmSync(root, {recursive: true, force: true});
});

test('a foreign id is dropped once another id on the marker verifies', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'marker-'));
  capture(root, 'a');
  markUploaded(root, ['a'], 'own');
  markUploaded(root, ['a'], 'foreign');
  const drop = foreignMissing([
    {id: 'own', ok: true, missing: false},
    {id: 'foreign', ok: false, missing: true},
  ]);
  assert.deepEqual(drop, ['foreign']);
  assert.equal(dropSessionIds(root, 'a', drop), true);
  assert.equal(
    markVerified(root, 'a', 'own', {ok: true, laps: 22, fieldHash: 'abc'}),
    true,
  );
  const marker = JSON.parse(readFileSync(resolve(root, 'a', MARKER), 'utf8'));
  assert.deepEqual(marker.sessionIds, ['own']);
  assert.equal(marker.sessionId, 'own');
  assert.deepEqual(Object.keys(marker.verified), ['own']);
  assert.equal(marker.verified.own.laps, 22);
  rmSync(root, {recursive: true, force: true});
});

test('an absent id stays when nothing else on the marker verified', () => {
  assert.deepEqual(
    foreignMissing([{id: 'foreign', ok: false, missing: true}]),
    [],
  );
  assert.deepEqual(
    foreignMissing([
      {id: 'own', ok: false, missing: false},
      {id: 'foreign', ok: false, missing: true},
    ]),
    [],
  );
  assert.deepEqual(
    foreignMissing([
      {id: 'own', ok: true, missing: false},
      {id: 'foreign', ok: false, missing: false},
    ]),
    [],
  );
});
