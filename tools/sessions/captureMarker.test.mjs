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
import {MARKER, markUploaded} from './captureMarker.mjs';

const capture = (root, name) => {
  mkdirSync(resolve(root, name), {recursive: true});
  writeFileSync(resolve(root, name, 'meta.json'), '{}');
};

test('marks the captures a session used, and only those', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'marker-'));
  capture(root, 'a');
  capture(root, 'b');
  const marked = markUploaded(
    root,
    ['a'],
    's1',
    new Date('2026-10-09T15:00:00Z'),
  );
  assert.deepEqual(marked, ['a']);
  assert.deepEqual(
    JSON.parse(readFileSync(resolve(root, 'a', MARKER), 'utf8')),
    {
      sessionId: 's1',
      uploadedUtc: '2026-10-09T15:00:00.000Z',
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

test('a second session using the same capture rewrites the marker', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'marker-'));
  capture(root, 'a');
  markUploaded(root, ['a'], 's1', new Date('2026-10-09T15:00:00Z'));
  markUploaded(root, ['a'], 's2', new Date('2026-10-09T16:00:00Z'));
  assert.equal(
    JSON.parse(readFileSync(resolve(root, 'a', MARKER), 'utf8')).sessionId,
    's2',
  );
  rmSync(root, {recursive: true, force: true});
});
