import assert from 'node:assert/strict';
import net from 'node:net';
import {test} from 'node:test';

import {mirrorLocalhost, mirrorLoopback} from './loopbackMirror.mjs';

const listen = (host, port = 0, handler) =>
  new Promise((resolve, reject) => {
    const s = net.createServer(handler);
    s.once('error', reject);
    s.listen({host, port}, () => resolve(s));
  });
const close = s => new Promise(resolve => s?.close(resolve));
const ask = (host, port, text) =>
  new Promise((resolve, reject) => {
    const c = net.connect({host, port}, () => c.write(text));
    c.once('data', d => {
      c.destroy();
      resolve(d.toString());
    });
    c.once('error', reject);
  });

// A server on [::1] stands for Metro; skipped on a machine with no IPv6 loopback.
const v6 = await listen('::1', 0, s =>
  s.on('data', d => s.write(`echo:${d}`)),
).catch(() => null);

test(
  'a request to 127.0.0.1 reaches the server that only listens on [::1]',
  {skip: !v6},
  async () => {
    const port = v6.address().port;
    const mirror = await mirrorLoopback({port});
    try {
      assert.ok(mirror, 'it should listen on 127.0.0.1');
      assert.equal(mirror.address().address, '127.0.0.1');
      assert.equal(await ask('127.0.0.1', port, 'hi'), 'echo:hi');
    } finally {
      await close(mirror);
    }
  },
);

test(
  'it listens on loopback only, never on every interface',
  {skip: !v6},
  async () => {
    const mirror = await mirrorLoopback({port: v6.address().port});
    try {
      assert.equal(mirror.address().address, '127.0.0.1');
    } finally {
      await close(mirror);
    }
  },
);

test('with 127.0.0.1:port already taken it steps aside', async () => {
  const taken = await listen('127.0.0.1');
  try {
    assert.equal(await mirrorLoopback({port: taken.address().port}), null);
  } finally {
    await close(taken);
  }
});

test('it mirrors only where localhost is [::1]', {skip: !v6}, async () => {
  const port = v6.address().port;
  assert.equal(
    await mirrorLocalhost({port, lookup: async () => ({address: '127.0.0.1'})}),
    null,
  );
  const mirror = await mirrorLocalhost({
    port,
    lookup: async () => ({address: '::1'}),
  });
  try {
    assert.ok(mirror);
    assert.equal(await ask('127.0.0.1', port, 'x'), 'echo:x');
  } finally {
    await close(mirror);
  }
});

test.after(() => close(v6));
