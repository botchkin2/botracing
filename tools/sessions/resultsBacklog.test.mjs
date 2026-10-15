import assert from 'node:assert/strict';
import {test} from 'node:test';

import {uploadResultsBacklog} from './resultsBacklog.mjs';

const session = (id, over = {}) => ({
  id,
  files: [{info: {sim: 'lmu', driver: 'Me', sessionType: 'Race', ...over}}],
});
const found = {
  strikes: [
    {
      et: 1,
      lapNumber: 0,
      points: 0,
      outcome: 'none',
      ruling: 'No Further Action',
    },
  ],
  unplaced: 0,
  deletedLaps: [],
};

function run(sessions, state, results) {
  const calls = [];
  const store = {
    putResultsInput: async (owner, id, input) =>
      void calls.push(['put', owner, id, input.strikes.length]),
    markStale: async (id, owner) => void calls.push(['stale', id, owner]),
  };
  let saves = 0;
  return uploadResultsBacklog({
    sessions,
    state,
    store,
    ownerId: 'o1',
    spanOf: () => ({startMs: 0, endMs: 1}),
    resultsForSpan: (_span, driver, type) => {
      calls.push(['find', driver, type]);
      return results;
    },
    saveState: () => void saves++,
    log: () => {},
  }).then(sent => ({sent, calls, saves}));
}

test('an uploaded LMU session with a results file sends its input once and is marked stale', async () => {
  const state = {sessions: {s1: {}}};
  const r = await run([session('s1')], state, found);
  assert.deepEqual(r.calls, [
    ['find', 'Me', 'Race'],
    ['put', 'o1', 's1', 1],
    ['stale', 's1', 'o1'],
  ]);
  assert.equal(r.sent, 1);
  assert.equal(state.resultsInputs.s1, 'sent');
  // The next run does nothing for it.
  const again = await run([session('s1')], state, found);
  assert.deepEqual(again.calls, []);
});

test('no file keeps nothing and is not asked again; a session not uploaded yet, one that went up with its input, and iRacing are left alone', async () => {
  const state = {
    sessions: {s1: {}, s2: {}, s3: {}},
    resultsInputs: {s2: 'with-session'},
  };
  const r = await run(
    [
      session('s1'),
      session('s2'),
      session('s3', {sim: 'iracing'}),
      session('s4'),
    ],
    state,
    {absent: 'no results file covers the session'},
  );
  assert.deepEqual(r.calls, [['find', 'Me', 'Race']]);
  assert.equal(r.sent, 0);
  assert.equal(state.resultsInputs.s1, 'none');
  assert.equal(state.resultsInputs.s3, undefined);
  assert.equal(state.resultsInputs.s4, undefined);
  assert.equal(r.saves, 1);
});
