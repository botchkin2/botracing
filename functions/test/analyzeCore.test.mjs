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
