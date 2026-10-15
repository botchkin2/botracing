import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {LEASE_MS, handleAnalyze} from '../src/analyzeCore.ts';
import {Unauthorized} from '../src/ownerAccess.ts';

const ID = '4c96f9dfd54fd9ab';

function world({owners = {'Bearer a': 'botkin'}, analyze} = {}) {
  const leases = new Map();
  const runs = [];
  let tokens = 0;
  let clock = 1_000_000;
  const deps = {
    owner: async auth => {
      if (!owners[auth]) throw new Unauthorized('sign in');
      return owners[auth];
    },
    // The store only: the rules are analyzeCore's own (leases()).
    runTx: async (id, fn) =>
      fn({
        get: async () => leases.get(id) ?? null,
        set: lease => leases.set(id, lease),
        delete: () => leases.delete(id),
      }),
    token: () => `run-${++tokens}`,
    analyze:
      analyze ??
      (async (id, owner, fence) => {
        await fence();
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
  w.leases.set(ID, {until: 1_000_000 + 60_000, token: 'other'});
  const r = await handleAnalyze(w.deps, 'POST', `/api/analyze/${ID}`, 'Bearer a');
  assert.deepEqual(r, {status: 202, body: {state: 'running'}});
  assert.equal(w.runs.length, 0);
});

test('a lease left by a crashed run expires', async () => {
  const w = world();
  w.leases.set(ID, {until: 1_000_000 - 1, token: 'crashed'});
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
import {MAX_RUNS, liveLapLanded, runAnalysis} from '../src/analyzeCore.ts';

function liveWorld(stamps) {
  const w = world();
  let at = 0;
  const reads = [];
  w.deps.liveStamp = async () => {
    reads.push(stamps[Math.min(at, stamps.length - 1)]);
    return stamps[Math.min(at++, stamps.length - 1)];
  };
  return w;
}

test('a lap that lands during a run makes the run go again; then it stops', async () => {
  // Stamp read before and after each run: lap 5 lands during run 1.
  const w = liveWorld(['t4', 't5', 't5', 't5']);
  const run = await runAnalysis(w.deps, ID, 'botkin');
  assert.deepEqual(run, {state: 'done', laps: 21});
  assert.equal(w.runs.length, 2);
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
  w.leases.set(ID, {owner: 'botkin', until: w.deps.now() + LEASE_MS, token: 'other-run'});
  assert.deepEqual(await runAnalysis(w.deps, ID, 'botkin'), {state: 'running'});
  assert.equal(w.runs.length, 0);
});

test("only a live upload's new stamp starts a run: lap 1's create too, never analysis writing back", () => {
  const live = (at, n) => ({live: {updatedAt: at}, lapCount: n});
  assert.equal(liveLapLanded(live('t4', 4), live('t5', 5)), true);
  assert.equal(liveLapLanded(undefined, live('t1', 1)), true, 'lap 1 creates the doc');
  // Analysis writes the stamp it read and its own lap count: no run, even
  // when its lap count differs from the live part count.
  assert.equal(liveLapLanded(live('t5', 5), {...live('t5', 6), analysis: {v: 2}}), false);
  // A later live lap still starts one, whatever lap count analysis wrote.
  assert.equal(liveLapLanded(live('t5', 6), live('t6', 6)), true);
  // A game-file sync (no live block) never starts it.
  assert.equal(liveLapLanded({lapCount: 4}, {lapCount: 9}), false);
});

// spring #5375, #5389: two runs must never both write one session. Each test
// below fails against the lease before #622 (fixed 150 s, no token).
const timeout = file =>
  Number(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').match(/timeoutSeconds: (\d+)/)[1]);

test("the lease outlives either function's timeout, so it cannot run out under a live run", () => {
  for (const file of ['analyzeApi.ts', 'liveAnalyze.ts'])
    assert.ok(LEASE_MS > timeout(file) * 1000, `${file}: ${timeout(file)} s`);
});

test('a run at the timeout still holds its lease: a second start is refused', async () => {
  let second;
  const w = world({
    analyze: async (id, owner, fence) => {
      w.tick(timeout('liveAnalyze.ts') * 1000);
      second = await runAnalysis(w.deps, ID, 'botkin');
      await fence();
      return {laps: 21};
    },
  });
  assert.deepEqual(await runAnalysis(w.deps, ID, 'botkin'), {state: 'done', laps: 21});
  assert.deepEqual(second, {state: 'running'});
});

test("a run never deletes another run's lease", async () => {
  const w = world({
    analyze: async () => {
      // This run's lease is gone (expired, another run holds it now).
      w.leases.set(ID, {until: w.deps.now() + LEASE_MS, token: 'the-other-run'});
      return {laps: 21};
    },
  });
  await runAnalysis(w.deps, ID, 'botkin');
  assert.equal(w.leases.get(ID)?.token, 'the-other-run');
});

test('a run that lost its lease writes nothing: the fence stops it before the write', async () => {
  let wrote = false;
  const w = world({
    analyze: async (id, owner, fence) => {
      w.leases.set(ID, {until: w.deps.now() + LEASE_MS, token: 'the-other-run'});
      await fence();
      wrote = true;
      return {laps: 21};
    },
  });
  assert.deepEqual(await runAnalysis(w.deps, ID, 'botkin'), {state: 'running'});
  assert.equal(wrote, false);
  assert.equal(w.leases.get(ID)?.token, 'the-other-run');
});

test('an expired lease no longer passes the fence', async () => {
  let wrote = false;
  const w = world({
    analyze: async (id, owner, fence) => {
      w.tick(LEASE_MS + 1);
      await fence();
      wrote = true;
      return {laps: 21};
    },
  });
  assert.deepEqual(await runAnalysis(w.deps, ID, 'botkin'), {state: 'running'});
  assert.equal(wrote, false);
});

// A run over a session already current writes nothing (pit wall thread 69): an
// open that lands after a live lap's run ran a second full analysis.
test('a run over a current session is a no-op: nothing analysed, the lease let go, the open told done', async () => {
  const w = world();
  const asked = [];
  w.deps.stale = async (id, owner) => (asked.push([id, owner]), false);
  const r = await handleAnalyze(w.deps, 'POST', `/api/analyze/${ID}`, 'Bearer a');
  assert.deepEqual(r, {status: 200, body: {state: 'done'}});
  assert.deepEqual(asked, [[ID, 'botkin']]);
  assert.equal(w.runs.length, 0);
  assert.equal(w.leases.size, 0);
});

test('a stale session is analysed, and the test is asked only once the lease is held', async () => {
  const w = world();
  w.deps.stale = async () => {
    assert.equal(w.leases.size, 1, 'under the lease');
    return true;
  };
  assert.deepEqual(await runAnalysis(w.deps, ID, 'botkin'), {state: 'done', laps: 21});
  assert.equal(w.runs.length, 1);
});
