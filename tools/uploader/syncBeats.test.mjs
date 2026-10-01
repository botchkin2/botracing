// Run: node --test tools/uploader/syncBeats.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runWithBeats, syncBeats} from './syncBeats.mjs';

// A clock the test drives, and a beat it can hold open.
function fake() {
  const timers = new Map();
  let nextId = 1;
  const clock = {
    setInterval: (fn, ms) => {
      timers.set(nextId, {fn, ms});
      return nextId++;
    },
    clearInterval: id => timers.delete(id),
    tick: () => [...timers.values()].forEach(t => t.fn()),
    running: () => timers.size,
  };
  const calls = [];
  const pending = [];
  const beat = (state, force) => {
    calls.push([state, force]);
    return new Promise((resolve, reject) => pending.push({resolve, reject}));
  };
  return {clock, calls, pending, beat};
}

test('a tick forces a write, a progress line does not, and one write is in flight at a time', async () => {
  const f = fake();
  const b = syncBeats({beat: f.beat, intervalMs: 60000, timers: f.clock});
  f.clock.tick();
  assert.deepEqual(f.calls, [['syncing', true]]);
  b.progress(); // blocked: a write is in flight
  f.clock.tick(); // blocked too
  assert.equal(f.calls.length, 1);
  f.pending[0].resolve();
  await new Promise(r => setImmediate(r));
  b.progress();
  assert.deepEqual(f.calls[1], ['syncing', false]);
  f.pending[1].resolve();
  await b.stop();
});

test('stop waits for the write in flight, so a late syncing cannot land after the next state', async () => {
  const f = fake();
  const order = [];
  const beat = async (state, force) => {
    await f.beat(state, force);
    order.push('syncing landed');
  };
  const b = syncBeats({beat, intervalMs: 1, timers: f.clock});
  f.clock.tick();
  let stopped = false;
  const stopping = b.stop().then(() => {
    stopped = true;
    order.push('stopped');
  });
  await new Promise(r => setImmediate(r));
  assert.equal(stopped, false, 'stop must not resolve while a write is open');
  f.pending[0].resolve();
  await stopping;
  assert.deepEqual(order, ['syncing landed', 'stopped']);
});

test('after stop nothing is written and the timer is gone', async () => {
  const f = fake();
  const b = syncBeats({beat: f.beat, intervalMs: 1, timers: f.clock});
  await b.stop();
  assert.equal(f.clock.running(), 0);
  f.clock.tick();
  b.progress();
  assert.deepEqual(f.calls, []);
});

test('a failed write is logged, never thrown, and does not block the next one', async () => {
  const f = fake();
  const logged = [];
  const b = syncBeats({
    beat: f.beat,
    intervalMs: 1,
    log: m => logged.push(m),
    timers: f.clock,
  });
  f.clock.tick();
  f.pending[0].reject(new Error('offline'));
  await new Promise(r => setImmediate(r));
  assert.match(logged[0], /offline/);
  f.clock.tick();
  assert.equal(f.calls.length, 2);
  f.pending[1].resolve();
  await b.stop();
});

test('runWithBeats stops the beats when the sync throws, and passes the result through', async () => {
  const f = fake();
  await assert.rejects(
    runWithBeats({beat: f.beat, intervalMs: 1, timers: f.clock}, async () => {
      throw new Error('spawn failed');
    }),
    /spawn failed/,
  );
  assert.equal(f.clock.running(), 0, 'the timer must not outlive the sync');
  const g = fake();
  const out = await runWithBeats(
    {beat: g.beat, intervalMs: 1, timers: g.clock},
    async progress => {
      progress();
      g.pending[0].resolve();
      return 'result';
    },
  );
  assert.equal(out, 'result');
  assert.equal(g.clock.running(), 0);
});
