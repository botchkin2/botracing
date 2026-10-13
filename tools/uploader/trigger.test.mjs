// Run: node --test tools/uploader/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decide, decideLive, liveWake, retryDelayMin} from './trigger.mjs';

const MIN = 60 * 1000;
const base = {
  gameRunning: false,
  wasRunning: false,
  newestMtimeMs: 100 * MIN,
  lastRunAtMs: 50 * MIN,
  nowMs: 101 * MIN,
};

test('runs when the game exits after writing telemetry', () => {
  assert.deepEqual(decide({...base, wasRunning: true}), {
    run: true,
    reason: 'game exited',
  });
});

test('runs on new telemetry with no game, e.g. at logon after a crash', () => {
  assert.equal(decide({...base, lastRunAtMs: null}).run, true);
});

test('does nothing when nothing changed since the last sync', () => {
  assert.equal(decide({...base, lastRunAtMs: 100 * MIN}).run, false);
  assert.equal(decide({...base, newestMtimeMs: null}).run, false);
});

test('never syncs while the game runs, however long it is quiet', () => {
  assert.equal(
    decide({...base, gameRunning: true, wasRunning: true, nowMs: 500 * MIN})
      .run,
    false,
  );
});

test('a failed sync waits for its retry time, then runs again with nothing new', () => {
  const failed = {...base, lastRunAtMs: 200 * MIN, retryAtMs: 230 * MIN};
  assert.equal(decide({...failed, nowMs: 210 * MIN}).run, false);
  assert.deepEqual(decide({...failed, nowMs: 231 * MIN}), {
    run: true,
    reason: 'retry',
  });
});

test('retries back off: 30 min, then doubling, capped at 8 h', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 9].map(retryDelayMin),
    [30, 60, 120, 240, 480, 480, 480],
  );
});

test('a new analysis version resyncs once, never in game', () => {
  const same = {...base, lastRunAtMs: 100 * MIN};
  assert.equal(decide(same).run, false);
  assert.deepEqual(decide({...same, versionChanged: true}), {
    run: true,
    reason: 'new analysis version',
  });
  assert.equal(
    decide({...same, versionChanged: true, gameRunning: true}).run,
    false,
  );
});

test('a failed session waiting on its backoff does not hold back new work', () => {
  const waiting = {...base, sessionRetryAtMs: 130 * MIN};
  // A version bump and new telemetry both still run; the failing session is
  // skipped by sync.mjs --skip, not by holding the whole run.
  assert.equal(decide({...waiting, versionChanged: true}).run, true);
  assert.deepEqual(decide({...waiting, lastRunAtMs: 50 * MIN}), {
    run: true,
    reason: 'new telemetry',
  });
  // With nothing else new, only the retry time itself brings a run.
  const quiet = {...waiting, lastRunAtMs: 100 * MIN};
  assert.equal(decide(quiet).run, false);
  assert.deepEqual(decide({...quiet, nowMs: 131 * MIN}), {
    run: true,
    reason: 'retry',
  });
});

test('after a crash, the whole run waits for its retry, version bump or not', () => {
  const failing = {...base, versionChanged: true, retryAtMs: 130 * MIN};
  assert.deepEqual(decide({...failing, nowMs: 101 * MIN}), {
    run: false,
    reason: 'retry later',
  });
  assert.equal(decide({...failing, nowMs: 131 * MIN}).run, true);
});

test('files a run skipped as too fresh are looked at again once their quiet time is up', () => {
  // The skipped file is older than the run that skipped it, so without the
  // recheck "nothing new" would hold until something else changes the folder.
  const skipped = {...base, lastRunAtMs: 100 * MIN, newestMtimeMs: 99 * MIN};
  assert.equal(decide({...skipped, quietRetryAtMs: 104 * MIN}).run, false);
  assert.deepEqual(decide({...skipped, quietRetryAtMs: 101 * MIN}), {
    run: true,
    reason: 'files closed',
  });
  // Never in game, and a crashed run still waits for its own retry first.
  assert.equal(
    decide({...skipped, quietRetryAtMs: 101 * MIN, gameRunning: true}).run,
    false,
  );
  assert.equal(
    decide({...skipped, quietRetryAtMs: 101 * MIN, retryAtMs: 110 * MIN}).run,
    false,
  );
});


test('live: a new lap on disk while LMU runs is uploaded', () => {
  assert.deepEqual(
    decideLive({gameRunning: true, lastLapAtMs: 2000, lastLiveAtMs: 1000, liveBusy: false}),
    {run: true, reason: 'new lap'},
  );
});

test('live: the same lap twice, a running upload, or no game is not', () => {
  const at = {gameRunning: true, lastLapAtMs: 2000, liveBusy: false};
  assert.equal(decideLive({...at, lastLiveAtMs: 2000}).run, false);
  assert.equal(decideLive({...at, lastLiveAtMs: 1000, liveBusy: true}).run, false);
  assert.equal(decideLive({...at, gameRunning: false, lastLiveAtMs: 1000}).run, false);
  assert.equal(decideLive({...at, lastLapAtMs: null, lastLiveAtMs: null}).run, false);
});

test('live: the first lap of a session goes up', () => {
  assert.equal(decideLive({gameRunning: true, lastLapAtMs: 5, lastLiveAtMs: null, liveBusy: false}).run, true);
});

test('liveWake: a new lap on disk ends the wait', () => {
  const rec = {state: 'recording', lastLapAt: 'a'};
  assert.equal(liveWake([rec], [rec]), false);
  assert.equal(liveWake([rec], [{...rec, lastLapAt: 'b'}]), true);
  assert.equal(liveWake([{state: 'recording'}], [rec]), true);
});

test('liveWake: a recorder that starts recording ends the wait (the first lap of a drive is not held a whole tick)', () => {
  assert.equal(liveWake([{state: 'waiting'}], [{state: 'recording'}]), true);
  assert.equal(liveWake([null], [{state: 'recording'}]), true);
  assert.equal(liveWake([{state: 'waiting'}], [{state: 'waiting'}]), false);
  assert.equal(liveWake([null, null], [null, null]), false);
  // iRacing's recorder (the second sim) starting counts too.
  assert.equal(liveWake([null, {state: 'waiting'}], [null, {state: 'recording'}]), true);
});
