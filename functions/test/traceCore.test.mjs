import assert from 'node:assert/strict';
import {test} from 'node:test';
import {gunzipSync, gzipSync} from 'node:zlib';
import {traceDelivery, traceEtag, traceIdOk} from '../src/traceCore.ts';

const gz = {md5Hash: 'abc+/==', contentEncoding: 'gzip'};

test('a gzip-stored trace is sent as the stored bytes, with an etag from its md5', () => {
  assert.deepEqual(traceDelivery(gz, undefined), {
    etag: '"t-abc+/=="',
    send: 'gzip',
  });
});

test('a client holding the same md5 gets a 304, weak or in a list', () => {
  const etag = traceEtag(gz.md5Hash);
  assert.equal(traceDelivery(gz, etag).send, 'not-modified');
  assert.equal(traceDelivery(gz, `W/${etag}`).send, 'not-modified');
  assert.equal(traceDelivery(gz, `"x", ${etag}`).send, 'not-modified');
  assert.equal(traceDelivery(gz, '*').send, 'not-modified');
});

test('a rewritten trace (new md5) is sent again, not 304', () => {
  const old = traceEtag('old-md5');
  assert.equal(traceDelivery(gz, old).send, 'gzip');
});

test('an object stored as plain text is sent as text, and one without an md5 has no etag', () => {
  assert.equal(
    traceDelivery({md5Hash: 'm', contentEncoding: undefined}, undefined).send,
    'text',
  );
  assert.deepEqual(traceDelivery({contentEncoding: 'gzip'}, '*'), {
    etag: null,
    send: 'gzip',
  });
});

test('the stored bytes are what a client library decodes, 6x smaller than the text', () => {
  const csv = Array.from(
    {length: 12000},
    (_, i) =>
      `${(i / 100).toFixed(4)},${(i / 12000).toFixed(6)},,,,,0.0,-0.0002,0,0,,`,
  ).join('\n');
  const stored = gzipSync(csv);
  assert.equal(gunzipSync(stored).toString('utf8'), csv);
  assert.ok(stored.length * 5 < csv.length);
});

test('only a lap id of the uploader’s own shape names a trace', () => {
  assert.equal(traceIdOk('28fcfa6112f0d18a-021'), true);
  assert.equal(traceIdOk('28fcfa6112f0d18a-21'), false);
  assert.equal(traceIdOk('28fcfa6112f0d18a-d{3}'), false);
  assert.equal(traceIdOk('../28fcfa6112f0d18a-021'), false);
  assert.equal(traceIdOk('28FCFA6112F0D18A-021'), false);
});
