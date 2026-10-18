// The payload set itself, and the rule that keeps tests on it.
// Run: node --test contract/
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  loadPayloads,
  mutate,
  newShape,
  scrubProblem,
  shapeOf,
} from './payloads.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every payload loads and keeps the scrub rule', () => {
  const folders = readdirSync(join(repo, 'contract', 'payloads'));
  assert.deepEqual(folders.sort(), [
    'capture-meta',
    'heartbeat',
    'recorder-status',
  ]);
  for (const f of folders) assert.ok(loadPayloads(f).length > 0, f);
});

test('the scrub check catches what must never be committed', () => {
  for (const [text, what] of [
    ['"C:\\\\Users\\\\Michael\\\\AppData"', 'a Windows user folder'],
    ['"C:/Users/Michael/x"', 'a Windows user folder'],
    ['"/home/michael/x"', 'a home folder'],
    ['"someone@example.com"', 'an email'],
    ['"uid": "aB3dE5fG7hI9jK1lM3nO5pQ7rS9t"', 'a Firebase uid'],
    ['"eyJhbGciOi.eyJzdWIiOiIx.sig"', 'a token'],
  ])
    assert.equal(scrubProblem(text), what, text);
  // Ids the payloads do carry: a session id, a header hash, a host id.
  assert.equal(scrubProblem('"3dd964c50b309b8c" "deadbeef" "~\\\\x"'), null);
});

test('mutate changes one field of a copy, and refuses a field the payload lacks', () => {
  const body = {a: {b: 1, c: [{d: 2}]}};
  assert.deepEqual(mutate(body, 'a.b', 5), {a: {b: 5, c: [{d: 2}]}});
  assert.deepEqual(mutate(body, 'a.c.0.d', null), {a: {b: 1, c: [{d: null}]}});
  assert.deepEqual(mutate(body, 'a.b', undefined), {a: {c: [{d: 2}]}});
  assert.deepEqual(body, {a: {b: 1, c: [{d: 2}]}}, 'the payload is untouched');
  assert.throws(() => mutate(body, 'a.x', 1), /not in the payload/);
  assert.throws(() => mutate(body, 'x.y', 1), /not in the payload/);
});

test('a shape is keys and JSON types, never values', () => {
  assert.deepEqual(shapeOf({b: 1, a: [{x: 'y'}], c: null}), [
    ':object',
    '.a:array',
    '.a[]:object',
    '.a[].x:string',
    '.b:number',
    '.c:null',
  ]);
  const [beat] = loadPayloads('heartbeat');
  assert.deepEqual(newShape('heartbeat', beat.body), []);
  assert.deepEqual(
    newShape('heartbeat', mutate(beat.body, 'queue', 99)),
    [],
    'a new value of a known type is not new',
  );
  assert.deepEqual(newShape('heartbeat', mutate(beat.body, 'queue', '1')), [
    '.queue:string',
  ]);
});

// The lint (contract/README.md): a test of the tray/API line never writes a
// body field by hand. These are the fields only a tray body has; a test needs
// them from a payload, or mutate() of one.
const BODY_FIELD =
  /\b(gameVersion|layoutOk|layoutReason|lastChunkAt|captureBytes|droppedPct)\s*:\s*(['"`0-9.-]|true\b|false\b|null\b)|\bdisk:\s*\{/;
const LINTED = ['functions/test', 'tools/uploader', 'tools/dev', 'contract'];

test('no test of the tray/API line writes a tray body field by hand', () => {
  const hits = [];
  for (const dir of LINTED)
    for (const f of readdirSync(join(repo, dir))) {
      // Tests, and functions/test's shared helpers; never the senders.
      const helper = dir === 'functions/test' && f.endsWith('.mjs');
      if (!(helper || f.endsWith('.test.mjs')) || f === 'payloads.test.mjs')
        continue;
      readFileSync(join(repo, dir, f), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (BODY_FIELD.test(line))
            hits.push(`${dir}/${f}:${i + 1}: ${line.trim()}`);
        });
    }
  assert.deepEqual(
    hits,
    [],
    'load a payload (contract/payloads.mjs) or mutate() one',
  );
});
