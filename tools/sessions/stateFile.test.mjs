// Run: node --test tools/sessions/
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

import {readStateFile} from './stateFile.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'statefile-'));
const NOW = () => new Date('2026-10-31T01:30:00.000Z');
const corrupt = d => readdirSync(d).filter(f => f.includes('.corrupt-'));

test('a whole file is read as it is', () => {
  const d = dir();
  writeFileSync(join(d, 'state.json'), '{"since":"2026-07-12"}');
  const got = readStateFile(join(d, 'state.json'), {now: NOW});
  assert.deepEqual(got, {
    value: {since: '2026-07-12'},
    source: 'file',
    keptAs: null,
  });
});

test('no file is "missing", and a stray .bak does not turn it into a recovery', () => {
  const d = dir();
  writeFileSync(join(d, 'state.json.bak'), '{"a":1}');
  assert.equal(
    readStateFile(join(d, 'state.json'), {now: NOW}).source,
    'missing',
  );
});

for (const [name, bad] of [
  ['a zero-length file (a power cut after the rename)', ''],
  ['a torn file', '{"since":"2026-07-1'],
]) {
  test(`${name} recovers from the .bak, is kept aside and is restored`, () => {
    const d = dir();
    const path = join(d, 'state.json');
    writeFileSync(`${path}.bak`, '{"since":"2026-07-12","sessions":{"a":1}}');
    writeFileSync(path, bad);
    const got = readStateFile(path, {now: NOW});
    assert.equal(got.source, 'backup');
    assert.deepEqual(got.value, {since: '2026-07-12', sessions: {a: 1}});
    assert.equal(readFileSync(got.keptAs, 'utf8'), bad);
    assert.match(got.keptAs, /state\.json\.corrupt-2026-10-31T01-30-00-000Z$/);
    // A restart before the next save finds the restored file, not a missing one.
    assert.equal(readStateFile(path, {now: NOW}).source, 'file');
  });
}

test('no readable .bak either: the bad file is kept, the value is null so the caller starts fresh', () => {
  const d = dir();
  const path = join(d, 'state.json');
  writeFileSync(path, '');
  writeFileSync(`${path}.bak`, 'not json');
  const got = readStateFile(path, {now: NOW});
  assert.equal(got.source, 'unreadable');
  assert.equal(got.value, null);
  assert.equal(existsSync(got.keptAs), true);
  assert.equal(existsSync(path), false);
  assert.equal(corrupt(d).length, 1);
  assert.equal(
    readFileSync(`${path}.bak`, 'utf8'),
    'not json',
    'the bad .bak is left alone',
  );
});
