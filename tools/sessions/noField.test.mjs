import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {noteNoField, readNoField} from './noField.mjs';

const DAY = 86400000;
const now = Date.parse('2026-10-20T12:00:00Z');
const doc = (id, ago, why) => ({
  id,
  endedAt: new Date(now - ago).toISOString(),
  fieldMissing: why,
});

test('a recent session without a field is noted; one that gets a field leaves; an old one never shows', () => {
  const work = mkdtempSync(join(tmpdir(), 'nofield-'));
  noteNoField(work, doc('aaaaaaaaaaaaaaaa', DAY, 'not recorded'), now);
  noteNoField(work, doc('bbbbbbbbbbbbbbbb', 30 * DAY, 'not recorded'), now);
  assert.deepEqual(Object.keys(readNoField(work)), ['aaaaaaaaaaaaaaaa']);
  noteNoField(work, doc('aaaaaaaaaaaaaaaa', DAY, null), now);
  assert.deepEqual(readNoField(work), {});
});

test('an entry ages out after 14 days even when nothing else is noted', () => {
  const work = mkdtempSync(join(tmpdir(), 'nofield-'));
  noteNoField(work, doc('aaaaaaaaaaaaaaaa', 13 * DAY, 'x'), now);
  noteNoField(work, doc('cccccccccccccccc', DAY, 'y'), now + 2 * DAY);
  assert.deepEqual(Object.keys(readNoField(work)), ['cccccccccccccccc']);
});
