// Smoke test of the deployed upload endpoint, with two throwaway accounts.
//
//   SMOKE_TOKEN_A=<ID token> SMOKE_TOKEN_B=<ID token of another user> \
//     node functions/scripts/smokeUpload.mjs [https://botracing-61.web.app/api/upload]
//
// Runs the real client (tools/sessions/storeClient.mjs): who am I, a small doc
// write and read-back, one signed-URL PUT and read-back, then B refused on A's
// doc and file, then everything it wrote is deleted. Exits 1 on the first
// failure (after cleaning up). Not part of `node --test`: it needs the network
// and live tokens.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {defaultApi, httpBackend} from '../../tools/sessions/storeClient.mjs';

const tokenA = process.env.SMOKE_TOKEN_A;
const tokenB = process.env.SMOKE_TOKEN_B;
if (!tokenA || !tokenB) {
  console.error(
    'Set SMOKE_TOKEN_A and SMOKE_TOKEN_B (ID tokens of two users).',
  );
  process.exit(2);
}
const api = process.argv[2] ?? defaultApi;
const a = httpBackend({api, token: () => tokenA});
const b = httpBackend({api, token: () => tokenB});

const tag = `smoke${randomBytes(4).toString('hex')}`;
const step = name => console.log(`ok  ${name}`);
const written = {docs: [], files: []};

async function run() {
  const meA = await a.me();
  const meB = await b.me();
  assert.ok(meA.ownerKey && meB.ownerKey, 'me() returns an ownerKey');
  assert.notEqual(
    meA.ownerKey,
    meB.ownerKey,
    'A and B must be different users',
  );
  step(`me: A=${meA.ownerKey} B=${meB.ownerKey}`);

  const sessionId = `${tag}`;
  written.docs.push({coll: 'sessions', id: sessionId});
  await a.writeDocs([
    {
      op: 'set',
      coll: 'sessions',
      id: sessionId,
      data: {ownerId: meA.ownerKey, series: 'smoke'},
    },
  ]);
  assert.equal((await a.getDoc('sessions', sessionId)).series, 'smoke');
  step('A wrote a doc and read it back');

  const dest = `bands/${meA.ownerKey}/${tag}/v1.json.gz`;
  written.files.push(dest);
  await a.putFile(
    dest,
    {body: Buffer.from('{"smoke":true}')},
    {contentType: 'application/json', gzip: true},
  );
  const back = await a.getFile(dest);
  assert.equal(gunzipSync(back).toString(), '{"smoke":true}');
  assert.ok(await a.fileMd5(dest), 'md5 of the stored file');
  step('A uploaded through a signed URL and read it back');

  assert.equal(await b.getDoc('sessions', sessionId), null);
  await assert.rejects(
    b.writeDocs([
      {
        op: 'set',
        coll: 'sessions',
        id: sessionId,
        data: {ownerId: meB.ownerKey, series: 'stolen'},
      },
    ]),
    /403/,
  );
  await assert.rejects(b.getFile(dest), /403/);
  assert.equal((await a.getDoc('sessions', sessionId)).series, 'smoke');
  step("B cannot read, overwrite or fetch A's data");
}

async function cleanup() {
  for (const {coll, id} of written.docs)
    await a
      .writeDocs([{op: 'delete', coll, id}])
      .catch(e => console.error('cleanup', e.message));
  for (const dest of written.files)
    await a.deleteFile(dest).catch(e => console.error('cleanup', e.message));
  console.log('cleaned up what the smoke wrote');
}

try {
  await run();
  await cleanup();
  console.log('SMOKE PASSED');
} catch (error) {
  console.error('SMOKE FAILED:', error.message);
  await cleanup();
  process.exit(1);
}
