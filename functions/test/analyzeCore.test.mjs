import assert from 'node:assert/strict';
import {test} from 'node:test';
import {LEASE_MS, handleAnalyze} from '../src/analyzeCore.ts';
import {Unauthorized} from '../src/ownerAccess.ts';

const ID = '4c96f9dfd54fd9ab';

function world({owners = {'Bearer a': 'botkin'}, analyze} = {}) {
  const leases = new Map();
  const runs = [];
  let clock = 1_000_000;
  const deps = {
    owner: async auth => {
      if (!owners[auth]) throw new Unauthorized('sign in');
      return owners[auth];
    },
    takeLease: async (id, owner, now) => {
      const held = leases.get(id);
      if (held && held > now) return false;
      leases.set(id, now + LEASE_MS);
      return true;
    },
    releaseLease: async id => void leases.delete(id),
    analyze:
      analyze ??
      (async (id, owner) => {
        runs.push([id, owner]);
        return {laps: 21};
      }),
    now: () => clock,
  };
  return {deps, leases, runs, tick: ms => (clock += ms)};
}

test('the owner analyses their session; the lease is let go after', async () => {
  const w = world();
  const r = await handleAnalyze(w.deps, 'POST', `/api/analyze/${ID}`, 'Bearer a');
  assert.deepEqual(r, {status: 200, body: {state: 'done', laps: 21}});
  assert.deepEqual(w.runs, [[ID, 'botkin']]);
  assert.equal(w.leases.size, 0);
});

test('no token is Unauthorized, and nothing runs', async () => {
  const w = world();
  await assert.rejects(
    handleAnalyze(w.deps, 'POST', `/api/analyze/${ID}`, undefined),
    Unauthorized,
  );
  assert.equal(w.runs.length, 0);
});

test("another owner's session is a 404 from the engine, and the lease is let go", async () => {
  const w = world({
    analyze: async () => {
      throw Object.assign(new Error('session not found'), {status: 404});
    },
  });
  const r = await handleAnalyze(w.deps, 'POST', `/api/analyze/${ID}`, 'Bearer a');
  assert.equal(r.status, 404);
  assert.equal(w.leases.size, 0);
});

test('a second open while a run holds the lease starts nothing: 202', async () => {
  const w = world();
  w.leases.set(ID, 1_000_000 + 60_000);
  const r = await handleAnalyze(w.deps, 'POST', `/api/analyze/${ID}`, 'Bearer a');
  assert.deepEqual(r, {status: 202, body: {state: 'running'}});
  assert.equal(w.runs.length, 0);
});

test('a lease left by a crashed run expires', async () => {
  const w = world();
  w.leases.set(ID, 1_000_000 - 1);
  const r = await handleAnalyze(w.deps, 'POST', `/api/analyze/${ID}`, 'Bearer a');
  assert.equal(r.status, 200);
});

test('only POST, and only a session id', async () => {
  const w = world();
  assert.equal((await handleAnalyze(w.deps, 'GET', `/api/analyze/${ID}`, 'Bearer a')).status, 405);
  assert.equal((await handleAnalyze(w.deps, 'POST', '/api/analyze/../x', 'Bearer a')).status, 404);
  assert.equal((await handleAnalyze(w.deps, 'POST', '/api/analyze/ABC', 'Bearer a')).status, 404);
  assert.equal(w.runs.length, 0);
});

test('an engine failure other than 404/409 propagates, and the lease is let go', async () => {
  const w = world({
    analyze: async () => {
      throw new Error('duckdb died');
    },
  });
  await assert.rejects(
    handleAnalyze(w.deps, 'POST', `/api/analyze/${ID}`, 'Bearer a'),
    /duckdb died/,
  );
  assert.equal(w.leases.size, 0);
});

// Live laps (roadmap row 1, pit wall #5232-#5252): a run goes again while laps
// land during it, so the last lap of a drive is analysed without an open.
import {MAX_RUNS, gainedLiveLap, runAnalysis} from '../src/analyzeCore.ts';

function liveWorld(stamps) {
  const w = world();
  let at = 0;
  const reads = [];
  w.deps.liveStamp = async () => {
    reads.push(stamps[Math.min(at, stamps.length - 1)]);
    return stamps[Math.min(at++, stamps.length - 1)];
  };
  const extended = [];
  w.deps.extendLease = async (id, owner, now) => {
    extended.push(now);
    w.leases.set(id, now + LEASE_MS);
  };
  return {...w, extended};
}

test('a lap that lands during a run makes the run go again; then it stops', async () => {
  // Stamp read before and after each run: lap 5 lands during run 1.
  const w = liveWorld(['t4', 't5', 't5', 't5']);
  const run = await runAnalysis(w.deps, ID, 'botkin');
  assert.deepEqual(run, {state: 'done', laps: 21});
  assert.equal(w.runs.length, 2);
  assert.equal(w.extended.length, 1, 'the lease is extended before the second run');
  assert.equal(w.leases.size, 0, 'and let go after');
});

test('re-runs stop at MAX_RUNS even if laps keep landing', async () => {
  const w = liveWorld(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  await runAnalysis(w.deps, ID, 'botkin');
  assert.equal(w.runs.length, MAX_RUNS);
});

test('a session that was never live runs once', async () => {
  const w = liveWorld([null]);
  await runAnalysis(w.deps, ID, 'botkin');
  assert.equal(w.runs.length, 1);
});

test('a live lap while a run holds the lease starts nothing', async () => {
  const w = liveWorld(['t1']);
  await w.deps.takeLease(ID, 'botkin', w.deps.now());
  assert.deepEqual(await runAnalysis(w.deps, ID, 'botkin'), {state: 'running'});
  assert.equal(w.runs.length, 0);
});

test('only a live upload that raises the lap count starts a run, never analysis writing back', () => {
  const live = n => ({live: {updatedAt: 'x'}, lapCount: n});
  assert.equal(gainedLiveLap(live(4), live(5)), true);
  assert.equal(gainedLiveLap(undefined, live(1)), true);
  // Analysis writes the doc with the same lap count: no loop.
  assert.equal(gainedLiveLap(live(5), {...live(5), analysis: {v: 2}}), false);
  // A game-file sync (no live block) never starts it.
  assert.equal(gainedLiveLap({lapCount: 4}, {lapCount: 9}), false);
});
