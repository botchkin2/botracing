import assert from 'node:assert/strict';
import {test} from 'node:test';
import {LEASE_MS, LEASE_RENEW_MS, handleAnalyze} from '../src/analyzeCore.ts';
import {Unauthorized} from '../src/ownerAccess.ts';

const ID = '4c96f9dfd54fd9ab';

function world({owners = {'Bearer a': 'botkin'}, analyze} = {}) {
  const leases = new Map();
  const runs = [];
  const timers = [];
  let tokens = 0;
  let clock = 1_000_000;
  const deps = {
    owner: async auth => {
      if (!owners[auth]) throw new Unauthorized('sign in');
      return owners[auth];
    },
    takeLease: async (id, owner, now, token) => {
      const held = leases.get(id);
      if (held && held.until > now) return false;
      leases.set(id, {until: now + LEASE_MS, token});
      return true;
    },
    releaseLease: async (id, token) => {
      if (leases.get(id)?.token === token) leases.delete(id);
    },
    extendLease: async (id, owner, now, token) => {
      if (leases.get(id)?.token !== token) return false;
      leases.set(id, {until: now + LEASE_MS, token});
      return true;
    },
    every: (ms, fn) => {
      timers.push(fn);
      return () => timers.splice(timers.indexOf(fn), 1);
    },
    token: () => `run-${++tokens}`,
    analyze:
      analyze ??
      (async (id, owner) => {
        runs.push([id, owner]);
        return {laps: 21};
      }),
    now: () => clock,
  };
  return {deps, leases, runs, timers, tick: ms => (clock += ms)};
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
  const extended = [];
  const base = w.deps.extendLease;
  w.deps.extendLease = async (id, owner, now, token) => {
    extended.push(now);
    return base(id, owner, now, token);
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
  await w.deps.takeLease(ID, 'botkin', w.deps.now(), 'other-run');
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

// spring #5375: a run longer than the lease must keep it, and a run must never
// release a lease another run holds.
test('a long run renews its lease while it works, so no second run starts', async () => {
  let second;
  const w = world({
    analyze: async () => {
      // Two renewals' worth of work: the lease would have run out without them.
      for (let i = 0; i < 4; i++) {
        w.tick(LEASE_RENEW_MS);
        for (const fn of [...w.timers]) fn();
        await Promise.resolve();
      }
      second = await runAnalysis(w.deps, ID, 'botkin');
      return {laps: 21};
    },
  });
  assert.deepEqual(await runAnalysis(w.deps, ID, 'botkin'), {state: 'done', laps: 21});
  assert.deepEqual(second, {state: 'running'}, 'the renewed lease kept the second run out');
  assert.equal(w.timers.length, 0, 'renewal stops with the run');
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

test('a run whose lease was taken over stops before running again', async () => {
  let calls = 0;
  const w = world({
    analyze: async () => {
      calls++;
      w.leases.set(ID, {until: w.deps.now() + LEASE_MS, token: 'the-other-run'});
      return {laps: 21};
    },
  });
  w.deps.liveStamp = (() => {
    let n = 0;
    return async () => `t${n++}`;
  })();
  await runAnalysis(w.deps, ID, 'botkin');
  assert.equal(calls, 1, 'the stamp moved, but the lease is not ours: no second write');
});
