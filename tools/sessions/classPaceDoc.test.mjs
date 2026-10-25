// The session doc's classPace (src/analysis/classPace.ts) must be a document
// Firestore takes (docShape.mjs: no array inside an array, no undefined, finite
// numbers) and a small one: a 60-car, 60-lap race is about 13 KB, never O(laps).
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {classPaceDoc} from '../../src/analysis/classPace.ts';
import {docProblems, MAX_DOC_BYTES} from './docShape.mjs';

const lap = (t, k) => ({
  t,
  s1: t * 0.4,
  s2: t * 0.3,
  s3: k % 7 === 0 ? null : t * 0.3,
  pit: false,
});
const drivers = Array.from({length: 60}, (_, i) => ({
  player: i === 0,
  cls: i % 3 ? 'GT3' : 'LMP2_ELMS',
  car: 'Porsche 911 GT3 R LMGT3',
  pos: i + 1,
  laps: Array.from({length: 60}, (_, k) =>
    k % 10 === 0
      ? {t: null, s1: null, s2: null, s3: null, pit: true}
      : lap(105 + i * 0.1 + Math.sin(k) * 0.4, k),
  ),
}));

test('classPace is a document Firestore takes, and its size follows the cars, not the laps', () => {
  const doc = classPaceDoc(drivers);
  assert.deepEqual(docProblems({classPace: doc}), []);
  const bytes = JSON.stringify(doc).length;
  assert.ok(bytes < 20_000, `${bytes} bytes for 60 cars`);
  assert.ok(bytes < MAX_DOC_BYTES / 40);
  const longer = classPaceDoc(
    drivers.map(d => ({...d, laps: [...d.laps, ...d.laps, ...d.laps]})),
  );
  // three times the laps: the same cars, the same keys, about the same bytes
  assert.ok(JSON.stringify(longer).length < bytes * 1.1);
});
