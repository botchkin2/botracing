import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  readResultsInput,
  resultsInput,
  resultsInputPath,
} from './resultsInput.mjs';

const found = {
  strikes: [
    {
      et: 1390.7,
      points: 0.25,
      outcome: 'warning',
      ruling: 'Warning',
    },
  ],
  unplaced: 2,
  coveredFrom: 7.1,
  coveredTo: 2800.8,
};

test('the input is kept where the cloud looks for it, and round-trips', () => {
  assert.equal(resultsInputPath('o1', 's1'), 'inputs/o1/s1/results.json.gz');
  const kept = resultsInput(found);
  assert.deepEqual(readResultsInput(JSON.stringify(kept)), found);
});

test('no file, or a file the PC could not find a session in, keeps nothing', () => {
  assert.equal(
    resultsInput({absent: 'no results file covers the session'}),
    null,
  );
  assert.equal(resultsInput(null), null);
});

test('a stored input of an unknown version or a broken one reads as none', () => {
  assert.equal(readResultsInput('not json'), null);
  assert.equal(readResultsInput(JSON.stringify({v: 3, strikes: []})), null);
  assert.equal(readResultsInput(JSON.stringify({v: 0, strikes: []})), null);
  assert.equal(readResultsInput(JSON.stringify({v: 1})), null);
  assert.deepEqual(readResultsInput(JSON.stringify({v: 1, strikes: []})), {
    strikes: [],
    unplaced: 0,
    coveredFrom: null,
    coveredTo: null,
  });
});

// The v1 reader refused any other version and read it as none: his strikes would
// vanish on the next open of a session whose input went up as v2. The reader
// takes both, so a v1 file still gives its strikes and a v2 file gives them too.
test('a v1 input still gives its strikes and has no drivers; a v2 input gives both', () => {
  const v1 = readResultsInput(JSON.stringify(resultsInput(found)));
  assert.deepEqual(v1.strikes, found.strikes);
  assert.equal('drivers' in v1, false);
  const drivers = [
    {
      player: true,
      cls: 'GT3',
      car: 'Porsche 911 GT3 R LMGT3',
      pos: 3,
      laps: [
        {t: null, s1: null, s2: null, s3: null, pit: false},
        {t: 128.5963, s1: 48.6845, s2: 34.2366, s3: 45.6752, pit: true},
      ],
    },
  ];
  const v2 = readResultsInput(JSON.stringify({v: 2, ...found, drivers}));
  assert.deepEqual(v2.strikes, found.strikes);
  assert.equal(v2.unplaced, 2);
  assert.deepEqual(v2.drivers, drivers);
});

test('a v2 input with no drivers, or drivers that are not the stored shape, keeps what is readable', () => {
  const none = readResultsInput(JSON.stringify({v: 2, strikes: []}));
  assert.deepEqual(none.strikes, []);
  assert.equal('drivers' in none, false);
  const ok = {player: false, cls: 'GT3', car: 'M4', pos: 1, laps: []};
  const mixed = readResultsInput(
    JSON.stringify({
      v: 2,
      strikes: [],
      drivers: [ok, {cls: 7}, null, {cls: 'GT3', car: 'x', laps: 'no'}],
    }),
  );
  assert.deepEqual(mixed.drivers, [ok]);
  // A time the file lacks, or that is not a number, reads null, never 0.
  const odd = readResultsInput(
    JSON.stringify({
      v: 2,
      strikes: [],
      drivers: [{cls: 'GT3', car: 'x', laps: [{t: 'x', s1: null}]}],
    }),
  );
  assert.deepEqual(odd.drivers[0].laps, [
    {t: null, s1: null, s2: null, s3: null, pit: false},
  ]);
});
