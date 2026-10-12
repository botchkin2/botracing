import assert from 'node:assert/strict';
import {test} from 'node:test';

import {diffSummary} from './golden.mjs';
import {changedSlices, sessionOf, unexplained} from './gate.mjs';

const EXPECTED = 'tools/golden/expected/lmu-race-road-atlanta.json';

test('only an expected file names a session', () => {
  assert.equal(sessionOf(EXPECTED), 'lmu-race-road-atlanta');
  assert.equal(sessionOf('tools/golden/golden.mjs'), null);
  assert.equal(sessionOf('tools/golden/CHANGES.md'), null);
});

test('a changed session needs an entry with a real sentence', () => {
  assert.deepEqual(unexplained([EXPECTED], []), ['lmu-race-road-atlanta']);
  // The stub update.mjs writes does not count.
  assert.deepEqual(
    unexplained([EXPECTED], ['## 2026-10-10 lmu-race-road-atlanta', 'Why: TODO']),
    ['lmu-race-road-atlanta'],
  );
  // Too short to be a reason.
  assert.deepEqual(
    unexplained([EXPECTED], ['## 2026-10-10 lmu-race-road-atlanta', 'Why: fixed it']),
    ['lmu-race-road-atlanta'],
  );
  assert.deepEqual(
    unexplained(
      [EXPECTED],
      [
        '## 2026-10-10 lmu-race-road-atlanta',
        'Why: comparable now excludes yellow laps (apex 1234)',
      ],
    ),
    [],
  );
});

test('an entry explains its own session only, and no change needs no entry', () => {
  assert.deepEqual(
    unexplained(
      [EXPECTED, 'tools/golden/expected/iracing-race-road-atlanta.json'],
      ['## 2026-10-10 iracing-race-road-atlanta', 'Why: the stop kind reads the fuel added not the time'],
    ),
    ['lmu-race-road-atlanta'],
  );
  assert.deepEqual(unexplained(['tools/golden/golden.mjs'], []), []);
});

test('the diff names the path and both values, and caps itself', () => {
  assert.deepEqual(
    diffSummary({laps: [{time: 80.1, ok: true}]}, {laps: [{time: 80.2, ok: true}]}),
    ['laps.0.time: 80.1 -> 80.2'],
  );
  assert.deepEqual(diffSummary({a: 1}, {a: 1}), []);
  const many = diffSummary({}, Object.fromEntries(Array.from({length: 50}, (_, i) => [`k${i}`, i])), 5);
  assert.equal(many.length, 6);
  assert.match(many.at(-1), /45 more/);
});

test('a swapped slice is a change: the manifest’s sha256 for a session differs', () => {
  const base = {fixtures: {a: {'0.samples.parquet': {sha256: 'x'}}, b: {'0.samples.parquet': {sha256: 'y'}}}};
  const same = JSON.parse(JSON.stringify(base));
  assert.deepEqual(changedSlices(base, same), []);
  const swapped = JSON.parse(JSON.stringify(base));
  swapped.fixtures.b['0.samples.parquet'].sha256 = 'z';
  swapped.fixtures.c = {'0.samples.parquet': {sha256: 'n'}};
  assert.deepEqual(changedSlices(base, swapped), ['b', 'c']);
  assert.deepEqual(changedSlices(null, base), ['a', 'b']);
  // With unchanged expected files, the swapped slice still needs its entry.
  assert.deepEqual(unexplained([], [], ['b']), ['b']);
  assert.deepEqual(
    unexplained([], ['## 2026-10-11 b', 'Why: the slice was cut again with a longer lap range'], ['b']),
    [],
  );
});
