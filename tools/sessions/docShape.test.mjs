import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  checkDoc,
  docProblems,
  guardedWriter,
  MAX_DOC_BYTES,
} from './docShape.mjs';

test('arrays of objects, numbers, strings, nulls and empty arrays are fine', () => {
  const doc = {
    id: 'a',
    laps: [{n: 1, t: 80.5, tags: ['x'], none: null}],
    spans: [],
    nested: {deep: {list: [{a: 1}, {a: 2}]}},
  };
  assert.deepEqual(docProblems(doc), []);
  assert.doesNotThrow(() => checkDoc('laps/a', doc));
});

test('an array directly inside an array names its path (#219: [fromM, toM, s] spans)', () => {
  const doc = {
    traffic: {
      aheadSpans: [
        [100, 200, 1.5],
        [300, 400, 2],
      ],
    },
  };
  assert.deepEqual(docProblems(doc), [
    'traffic.aheadSpans[0]: an array directly inside an array',
    'traffic.aheadSpans[1]: an array directly inside an array',
  ]);
  assert.throws(
    () => checkDoc('laps/x', doc),
    /laps\/x cannot be written to Firestore: traffic\.aheadSpans\[0\]/,
  );
  // The same spans as objects are fine.
  assert.deepEqual(
    docProblems({traffic: {aheadSpans: [{fromM: 1, toM: 2, s: 3}]}}),
    [],
  );
});

test('undefined, NaN and Infinity are refused, with the field path', () => {
  assert.deepEqual(docProblems({a: {b: undefined}}), ['a.b: undefined']);
  assert.deepEqual(docProblems({list: [1, NaN]}), [
    'list[1]: NaN is not a finite number',
  ]);
  assert.deepEqual(docProblems({x: Infinity}), [
    'x: Infinity is not a finite number',
  ]);
});

test('an empty or reserved field name is refused', () => {
  assert.equal(docProblems({'': 1}).length, 1);
  assert.equal(docProblems({__name__: 1}).length, 1);
  assert.deepEqual(docProblems({_ok: 1, a__: 2, __a: 3}), []);
});

test('a document nested past 20 levels or over the size limit is refused', () => {
  let deep = {v: 1};
  for (let i = 0; i < 25; i++) deep = {d: deep};
  assert.match(docProblems(deep)[0], /nested deeper than 20 levels/);
  const big = {blob: 'x'.repeat(MAX_DOC_BYTES + 1)};
  assert.throws(
    () => checkDoc('trackBoundaries/t', big),
    /over the 900000 limit/,
  );
});

test('at most ten problems are listed', () => {
  const doc = {list: Array.from({length: 30}, () => [1])};
  assert.equal(docProblems(doc).length, 10);
});

function recordingWriter() {
  const calls = [];
  return {
    calls,
    set: (ref, data, options) => calls.push(['set', ref.path, data, options]),
    delete: ref => calls.push(['delete', ref.path]),
    close: async () => calls.push(['close']),
  };
}
const ref = path => ({path});

test('the guarded writer forwards everything, in order, deletes too, once the documents pass', async () => {
  const real = recordingWriter();
  const writer = guardedWriter(real);
  writer.set(ref('laps/a'), {n: 1});
  writer.delete(ref('laps/old'));
  writer.set(ref('tracks/t'), {id: 't'}, {merge: true});
  // Nothing goes out before the close.
  assert.deepEqual(real.calls, []);
  await writer.close();
  assert.deepEqual(real.calls, [
    ['set', 'laps/a', {n: 1}, undefined],
    ['delete', 'laps/old'],
    ['set', 'tracks/t', {id: 't'}, {merge: true}],
    ['close'],
  ]);
});

test('one bad document writes none of them, deletes included, and names the field', async () => {
  const real = recordingWriter();
  const writer = guardedWriter(real);
  writer.set(ref('recordings/r'), {id: 'r'});
  writer.set(ref('laps/bad'), {traffic: {aheadSpans: [[1, 2, 3]]}});
  writer.delete(ref('laps/old'));
  await assert.rejects(
    writer.close(),
    /laps\/bad cannot be written to Firestore: traffic\.aheadSpans\[0\]/,
  );
  assert.deepEqual(real.calls, []);
});

test('several bad documents are counted in one error', async () => {
  const real = recordingWriter();
  const writer = guardedWriter(real);
  writer.set(ref('laps/a'), {x: undefined});
  writer.set(ref('laps/b'), {y: NaN});
  await assert.rejects(
    writer.close(),
    /2 documents cannot be written to Firestore/,
  );
  assert.deepEqual(real.calls, []);
});
