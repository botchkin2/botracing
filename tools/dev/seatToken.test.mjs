import assert from 'node:assert/strict';
import {test} from 'node:test';

import {SEAT_TOKEN_PATH, seatTokenMiddleware} from './seatToken.mjs';

const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.secret.sig';

const run = async ({url = SEAT_TOKEN_PATH, method = 'GET', host = 'localhost:19101', peer = '127.0.0.1', mint, port = 19101}) => {
  const logs = [];
  const handler = seatTokenMiddleware({
    port,
    mint: mint ?? (async () => TOKEN),
    log: line => logs.push(line),
  });
  const res = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(body) {
      this.body = body ?? '';
    },
  };
  let passed = false;
  await handler({url, method, headers: {host}, socket: {remoteAddress: peer}}, res, () => {
    passed = true;
  });
  return {res, passed, logs};
};

test('serves the token on localhost and 127.0.0.1 of its own port, no CORS, no-store', async () => {
  for (const host of ['localhost:19101', '127.0.0.1:19101']) {
    const {res} = await run({host});
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), {token: TOKEN});
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(
      Object.keys(res.headers).filter(k => k.startsWith('access-control')).length,
      0,
    );
  }
});

test('refuses any other Host (DNS rebinding), another port, and other methods', async () => {
  for (const host of ['evil.example:19101', 'localhost:19102', 'localhost', '']) {
    const {res} = await run({host});
    assert.equal(res.statusCode, 404, host);
    assert.equal(res.body, '');
  }
  assert.equal((await run({method: 'POST'})).res.statusCode, 404);
});

test('passes every other path on to Metro', async () => {
  const {passed, res} = await run({url: '/index.bundle?platform=web'});
  assert.equal(passed, true);
  assert.equal(res.statusCode, 0);
});

test('a failed mint answers 503 and logs without the token', async () => {
  const {res, logs} = await run({
    mint: async () => {
      throw new Error('SMOKE_SERVICE_ACCOUNT is not set');
    },
  });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body, '');
  assert.equal(logs.length, 1);
});

test('the token never reaches stdout or stderr', async () => {
  const seen = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk, ...rest) => (seen.push(String(chunk)), true);
  process.stderr.write = (chunk, ...rest) => (seen.push(String(chunk)), true);
  try {
    const handler = seatTokenMiddleware({port: 19101, mint: async () => TOKEN});
    const res = {setHeader() {}, end() {}};
    await handler({url: SEAT_TOKEN_PATH, method: 'GET', headers: {host: 'localhost:19101'}, socket: {remoteAddress: '127.0.0.1'}}, res, () => {});
    const failing = seatTokenMiddleware({
      port: 19101,
      mint: async () => {
        throw new Error('no service account');
      },
    });
    await failing({url: SEAT_TOKEN_PATH, method: 'GET', headers: {host: 'localhost:19101'}, socket: {remoteAddress: '127.0.0.1'}}, res, () => {});
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
  assert.equal(seen.join('').includes('eyJ'), false);
});

test('a LAN client with a forged Host header gets 404 and no token', async () => {
  for (const peer of ['192.168.1.20', '10.0.0.5', 'fe80::1', '']) {
    const {res} = await run({host: 'localhost:19101', peer});
    assert.equal(res.statusCode, 404, peer);
    assert.equal(res.body, '');
  }
});

test('every loopback form of the peer is served, with nosniff', async () => {
  for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    const {res} = await run({peer});
    assert.equal(res.statusCode, 200, peer);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  }
});
