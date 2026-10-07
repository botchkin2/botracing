import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {
  FAILURE_WAIT_MS,
  KEEP_ALIVE_MS,
  MIN_GAP_MS,
  bodyOf,
  createHeartbeatSender,
  httpSend,
  statusKey,
} from './heartbeatSender.mjs';

const doc = (over = {}) => ({
  hostId: 'ab12cd34',
  label: 'Race PC',
  version: '0.1.0',
  lmuFound: true,
  state: 'idle',
  lastSeenAt: '2026-10-06T10:00:00Z',
  lastUploadAt: null,
  lastError: null,
  retryAt: null,
  queue: 0,
  progress: null,
  recorder: {state: 'running', layoutOk: true},
  ...over,
});

// A clock and a timer list the test drives by hand.
function harness(responses) {
  let t = 1_000_000;
  const timers = [];
  const sent = [];
  const sender = createHeartbeatSender({
    send: async body => {
      sent.push({body, at: t});
      const r = responses.shift() ?? {status: 204};
      if (r instanceof Error) throw r;
      return r;
    },
    now: () => t,
    setTimer: (fn, ms) => timers.push({fn, at: t + ms}),
    log: () => {},
  });
  const advance = async ms => {
    t += ms;
    for (const timer of timers.filter(x => x.at <= t)) {
      timers.splice(timers.indexOf(timer), 1);
      await timer.fn();
    }
  };
  return {sender, sent, timers, advance};
}

test('the first status is sent, without the stamp the server makes itself', async () => {
  const h = harness([]);
  await h.sender.offer(doc());
  assert.equal(h.sent.length, 1);
  assert.equal('lastSeenAt' in h.sent[0].body, false);
  assert.equal(h.sent[0].body.state, 'idle');
  assert.equal(bodyOf(doc()).hostId, 'ab12cd34');
});

test('progress ticks and queue changes send nothing; a state change does (after the 30 s gap); a keep-alive after 10 min', async () => {
  const h = harness([]);
  await h.sender.offer(doc());
  await h.sender.offer(doc({progress: {done: 1, total: 9}, queue: 3}));
  await h.sender.offer(doc({progress: {done: 2, total: 9}}));
  assert.equal(h.sent.length, 1, 'no request for progress or queue');
  await h.advance(MIN_GAP_MS + 1000);
  await h.sender.offer(doc({state: 'syncing'}));
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].body.state, 'syncing');
  await h.advance(KEEP_ALIVE_MS - 1000);
  await h.sender.offer(doc({state: 'syncing'}));
  assert.equal(h.sent.length, 2, 'not yet');
  await h.advance(2000);
  await h.sender.offer(doc({state: 'syncing'}));
  assert.equal(h.sent.length, 3, 'the keep-alive');
});

test('a state change inside the 30 s gap waits, and goes out by itself with the latest state', async () => {
  const h = harness([]);
  await h.sender.offer(doc());
  await h.sender.offer(doc({state: 'syncing'}));
  await h.sender.offer(
    doc({state: 'error', lastError: {at: 'x', message: 'm', path: null}}),
  );
  assert.equal(h.sent.length, 1, 'held back by the minimum gap');
  assert.equal(h.timers.length >= 1, true, 'a timer is set');
  await h.advance(MIN_GAP_MS + 100);
  assert.equal(h.sent.length, 2);
  assert.equal(
    h.sent[1].body.state,
    'error',
    'only the latest, not the one between',
  );
});

test('a 429 keeps only the latest state and sends it after Retry-After', async () => {
  const h = harness([{status: 429, retryAfterSec: 20}]);
  await h.sender.offer(doc());
  assert.equal(h.sent.length, 1);
  await h.sender.offer(doc({state: 'syncing'}));
  assert.equal(h.sent.length, 1, 'still waiting');
  await h.advance(21_000);
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].body.state, 'syncing', 'the latest, not the first');
});

test('an offline failure retries after a minute; a refusal (400) is not repeated, but a new state is tried', async () => {
  const h = harness([
    new Error('fetch failed'),
    {status: 400, reason: 'bad body'},
  ]);
  await h.sender.offer(doc());
  await h.advance(FAILURE_WAIT_MS + 100);
  assert.equal(h.sent.length, 2, 'retried after the wait');
  await h.advance(FAILURE_WAIT_MS + 100);
  assert.equal(h.sent.length, 2, 'a refused body is not sent again');
  await h.sender.offer(doc({state: 'error'}));
  await h.advance(FAILURE_WAIT_MS + 100);
  assert.equal(h.sent.length, 3, 'a new state is tried');
});

test('statusKey ignores progress, queue and the time', () => {
  assert.equal(
    statusKey(doc()),
    statusKey(doc({progress: {done: 1}, queue: 5, lastSeenAt: 'later'})),
  );
  assert.notEqual(statusKey(doc()), statusKey(doc({state: 'syncing'})));
  assert.notEqual(
    statusKey(doc()),
    statusKey(doc({recorder: {state: 'stopped', layoutOk: true}})),
  );
});

test('the real send: bearer from the token file read per request, JSON body, 204 ok, 429 carries Retry-After, 401 is reported', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hb-'));
  const tokenFile = join(dir, 'token');
  writeFileSync(tokenFile, 'tok-1\n');
  const calls = [];
  const replies = [
    new Response(null, {status: 204}),
    new Response('slow down', {status: 429, headers: {'retry-after': '17'}}),
    new Response('no', {status: 401}),
  ];
  const send = httpSend({
    api: 'https://x.test/api/upload',
    tokenFile,
    fetch: async (url, init) => {
      calls.push({url, init});
      return replies.shift();
    },
  });
  assert.deepEqual(await send({hostId: 'h'}), {status: 204});
  writeFileSync(tokenFile, 'tok-2\n');
  assert.deepEqual(await send({hostId: 'h'}), {status: 429, retryAfterSec: 17});
  assert.deepEqual(await send({hostId: 'h'}), {status: 401, reason: 'no'});
  assert.equal(calls[0].url, 'https://x.test/api/upload/heartbeat');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer tok-1');
  assert.equal(
    calls[1].init.headers.authorization,
    'Bearer tok-2',
    'the refreshed token',
  );
  assert.equal(calls[0].init.body, '{"hostId":"h"}');
});
