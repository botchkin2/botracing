import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  RETRY_WINDOW_MS,
  backlogCandidates,
  backlogDue,
  uploadResultsBacklog,
} from './resultsBacklog.mjs';
import {resultsDue} from '../uploader/trigger.mjs';

const MIN = 60_000;
const found = {
  strikes: [{et: 1, points: 0, outcome: 'none', ruling: 'No Further Action'}],
  unplaced: 0,
  coveredFrom: 7.1,
  coveredTo: 100,
  drivers: [],
};
const absent = {absent: 'no results file covers the session'};

const cand = (id, endMs, over = {}) => ({
  id,
  driver: 'Me',
  sessionType: 'Race',
  span: {startMs: endMs - 30 * MIN, endMs},
  ...over,
});

function harness(state) {
  const calls = [];
  const store = {
    putResultsInput: async (owner, id) => void calls.push(['put', owner, id]),
    markStale: async id => void calls.push(['stale', id]),
  };
  return {
    calls,
    pass: (candidates, nowMs, run, results) =>
      uploadResultsBacklog({
        candidates,
        state,
        store,
        ownerId: 'o1',
        resultsForSpan: (_s, driver, type) => {
          calls.push(['find', driver, type]);
          return results;
        },
        saveState: () => {},
        log: () => {},
        nowMs,
        run,
      }),
  };
}

test('a stored session with a results file sends its input once and is marked stale', async () => {
  const state = {};
  const h = harness(state);
  assert.equal(await h.pass([cand('s1', 0)], 100 * MIN, 'r1', found), 1);
  assert.deepEqual(h.calls, [
    ['find', 'Me', 'Race'],
    ['put', 'o1', 's1'],
    ['stale', 's1'],
  ]);
  assert.deepEqual(state.resultsInputs.s1, {v: 2});
  h.calls.length = 0;
  await h.pass([cand('s1', 0)], 200 * MIN, 'r1', found);
  assert.deepEqual(h.calls, []);
});

test('a session closed at t whose file appears at t+10 s is found by the next tick', async () => {
  const state = {};
  const h = harness(state);
  const end = 1_000_000;
  const c = [cand('live1', end)];
  assert.equal(await h.pass(c, end + 1_000, 'r1', absent), 0);
  assert.equal(state.resultsInputs.live1.none, true);
  // Next tick, file there now: found though 'none' was recorded before.
  assert.equal(await h.pass(c, end + 11_000, 'r1', found), 1);
  assert.deepEqual(state.resultsInputs.live1, {v: 2});
});

test('no file is asked again every run inside the window, then once per tray start', async () => {
  const state = {};
  const h = harness(state);
  const end = 0;
  const c = [cand('s1', end)];
  await h.pass(c, 1 * MIN, 'r1', absent);
  await h.pass(c, 2 * MIN, 'r1', absent);
  assert.equal(h.calls.filter(x => x[0] === 'find').length, 2);
  // Past the window, same start: not asked.
  const late = RETRY_WINDOW_MS + 5 * MIN;
  await h.pass(c, late, 'r1', absent); // first look after the window, run r1 already recorded
  assert.equal(h.calls.filter(x => x[0] === 'find').length, 2);
  await h.pass(c, late + MIN, 'r1', absent);
  assert.equal(h.calls.filter(x => x[0] === 'find').length, 2);
  // A new tray start looks once more, and finds last week's file.
  assert.equal(await h.pass(c, late + 2 * MIN, 'r2', found), 1);
  assert.deepEqual(state.resultsInputs.s1, {v: 2});
});

test('what went up at v2, with the session or on its own, is left alone', async () => {
  const state = {resultsInputs: {s1: {v: 2}}};
  const h = harness(state);
  await h.pass([cand('s1', 0)], 1 * MIN, 'r1', found);
  assert.deepEqual(h.calls, []);
});

test('a v1 input (the strings a tray before v2 wrote) is sent again once, with the drivers, and marked stale', async () => {
  for (const old of ['sent', 'with-session']) {
    const state = {resultsInputs: {s1: old}};
    const h = harness(state);
    assert.equal(await h.pass([cand('s1', 0)], 1 * MIN, 'r1', found), 1);
    assert.deepEqual(h.calls, [
      ['find', 'Me', 'Race'],
      ['put', 'o1', 's1'],
      ['stale', 's1'],
    ]);
    assert.deepEqual(state.resultsInputs.s1, {v: 2});
    h.calls.length = 0;
    await h.pass([cand('s1', 0)], 2 * MIN, 'r2', found);
    assert.deepEqual(h.calls, [], 'not again');
  }
});

test('a v1 input whose file the game no longer has keeps its v1 and is not looked for every run', async () => {
  const state = {resultsInputs: {s1: 'sent'}};
  const h = harness(state);
  assert.equal(await h.pass([cand('s1', 0)], 1 * MIN, 'r1', absent), 0);
  assert.deepEqual(h.calls, [['find', 'Me', 'Race']]);
  assert.deepEqual(
    state.resultsInputs.s1,
    {v: 1, gone: true},
    'the state says what is stored: a v1',
  );
  h.calls.length = 0;
  await h.pass([cand('s1', 0)], 2 * MIN, 'r2', absent);
  assert.deepEqual(h.calls, []);
});

test('backlogDue wakes a run for a v1 entry and not for a v2 one or a v1 whose file is gone', () => {
  const c = [cand('s1', 0)];
  assert.equal(
    backlogDue({candidates: c, state: {resultsInputs: {s1: 'sent'}}, nowMs: MIN, run: 'r1'}),
    true,
  );
  assert.equal(
    backlogDue({candidates: c, state: {resultsInputs: {s1: {v: 2}}}, nowMs: MIN, run: 'r1'}),
    false,
  );
  assert.equal(
    backlogDue({
      candidates: c,
      state: {resultsInputs: {s1: {v: 1, gone: true}}},
      nowMs: MIN,
      run: 'r2',
    }),
    false,
  );
});

test('candidates: game-file sessions that are stored, and live sessions grouped by id', () => {
  const session = (id, sim = 'lmu') => ({
    id,
    files: [{info: {sim, driver: 'Me', sessionType: 'Race'}}],
  });
  const out = backlogCandidates({
    sessions: [session('g1'), session('g2'), session('g3', 'iracing')],
    state: {sessions: {g1: {}, g3: {}}},
    spanOf: () => ({startMs: 1, endMs: 2}),
    liveIndex: {
      'a#0': {
        sessionId: 'L1',
        sim: 'lmu',
        driver: 'Me',
        sessionType: 'Qualify',
        startMs: 10,
        endMs: 20,
      },
      'a#1': {
        sessionId: 'L1',
        sim: 'lmu',
        driver: 'Me',
        sessionType: 'Qualify',
        startMs: 30,
        endMs: 40,
      },
      'i#0': {sessionId: 'L2', sim: 'iracing', startMs: 1, endMs: 2},
    },
    captureRoot: null,
  });
  assert.deepEqual(
    out.map(c => [c.id, c.sessionType, c.span]),
    [
      ['g1', 'Race', {startMs: 1, endMs: 2}],
      ['L1', 'Qualify', {startMs: 10, endMs: 40}],
    ],
  );
});

test('backlogDue and the watcher trigger agree on what is worth a run', () => {
  const state = {resultsInputs: {s1: {none: true, atMs: 0, run: 'r1'}}};
  const c = [cand('s1', 0)];
  assert.equal(backlogDue({candidates: c, state, nowMs: MIN, run: 'r1'}), true);
  assert.equal(
    backlogDue({candidates: c, state, nowMs: RETRY_WINDOW_MS + MIN, run: 'r1'}),
    false,
  );
  assert.equal(
    backlogDue({candidates: c, state, nowMs: RETRY_WINDOW_MS + MIN, run: 'r2'}),
    true,
  );
  // The watcher: first tick of a start, then each minute while a session ended recently.
  assert.equal(resultsDue({liveEnds: [], nowMs: 5, lastRunMs: null}), 'all');
  assert.equal(resultsDue({liveEnds: [0], nowMs: 30_000, lastRunMs: 0}), null);
  assert.equal(resultsDue({liveEnds: [0], nowMs: 61_000, lastRunMs: 0}), 'live');
  assert.equal(
    resultsDue({liveEnds: [0], nowMs: RETRY_WINDOW_MS + MIN, lastRunMs: 0}),
    null,
  );
});
