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

test('a stored input of another version or a broken one reads as none', () => {
  assert.equal(readResultsInput('not json'), null);
  assert.equal(readResultsInput(JSON.stringify({v: 2, strikes: []})), null);
  assert.equal(readResultsInput(JSON.stringify({v: 1})), null);
  assert.deepEqual(readResultsInput(JSON.stringify({v: 1, strikes: []})), {
    strikes: [],
    unplaced: 0,
    coveredFrom: null,
    coveredTo: null,
  });
});
