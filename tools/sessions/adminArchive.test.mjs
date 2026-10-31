// Run: node --test tools/sessions/adminArchive.test.mjs
// Ticket 89: the Admin backend stores archive/{sim}/... under the owner's
// folder, as the upload API does, because analysis reads an archive only there.
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

import {analyzeStored} from './analyzeStored.mjs';
import {adminBackend} from './store.mjs';

// The few Firestore and Storage calls the file primitives and getDoc use.
function fakes(docs = {}) {
  const objects = new Map();
  const bucket = {
    file: name => ({
      save: async body => void objects.set(name, Buffer.from(body)),
      getMetadata: async () => {
        if (!objects.has(name))
          throw Object.assign(new Error('no'), {code: 404});
        return [{md5Hash: 'md5'}];
      },
      download: async () => {
        if (!objects.has(name))
          throw Object.assign(new Error('no'), {code: 404});
        return [objects.get(name)];
      },
      delete: async () => void objects.delete(name),
    }),
    getFiles: async ({prefix}) => [
      [...objects.keys()]
        .filter(n => n.startsWith(prefix))
        .map(name => ({name})),
    ],
  };
  const db = {
    collection: coll => ({
      doc: id => ({
        get: async () => ({
          exists: `${coll}/${id}` in docs,
          data: () => docs[`${coll}/${id}`],
        }),
      }),
    }),
  };
  return {objects, bucket, db};
}

const put = (backend, dest) =>
  backend.putFile(
    dest,
    {body: Buffer.from('S')},
    {contentType: 'x', gzip: false},
  );

test('an archive/{sim} name is stored, read, hashed, listed and deleted under the owner', async () => {
  const {objects, bucket, db} = fakes();
  const backend = adminBackend({db, bucket, ownerKey: 'botkin'});
  await put(backend, 'archive/lmu/s1/r1/samples.parquet');
  assert.deepEqual(
    [...objects.keys()],
    ['archive/botkin/lmu/s1/r1/samples.parquet'],
  );
  assert.equal(
    await backend.fileMd5('archive/lmu/s1/r1/samples.parquet'),
    'md5',
  );
  assert.equal(
    (await backend.getFile('archive/lmu/s1/r1/samples.parquet')).toString(),
    'S',
  );
  assert.deepEqual(await backend.listFiles('archive/lmu/s1/'), [
    'archive/lmu/s1/r1/samples.parquet',
  ]);
  // Other folders are as given.
  await put(backend, 'field/botkin/s1/h.json.gz');
  assert.ok(objects.has('field/botkin/s1/h.json.gz'));
  await backend.deleteFile('archive/lmu/s1/r1/samples.parquet');
  assert.equal(objects.has('archive/botkin/lmu/s1/r1/samples.parquet'), false);
});

test('without an owner names are used as given (the cloud hands over names already under the owner)', async () => {
  const {objects, bucket, db} = fakes();
  const backend = adminBackend({db, bucket});
  await put(backend, 'archive/botkin/lmu/s1/r1/samples.parquet');
  await put(backend, 'archive/lmu/s1/r1/samples.parquet');
  assert.deepEqual([...objects.keys()].sort(), [
    'archive/botkin/lmu/s1/r1/samples.parquet',
    'archive/lmu/s1/r1/samples.parquet',
  ]);
});

test('a session uploaded with Admin credentials is found by analysis on open', async () => {
  const docs = {
    'sessions/s1': {id: 's1', ownerId: 'botkin', recordingIds: ['r1']},
    'recordings/r1': {
      id: 'r1',
      ownerId: 'botkin',
      sim: 'lmu',
      archive: {
        samples: 'archive/lmu/s1/r1/samples.parquet',
        events: 'archive/lmu/s1/r1/events.parquet',
      },
    },
  };
  const {bucket, db} = fakes(docs);
  const backend = adminBackend({db, bucket, ownerKey: 'botkin'});
  await put(backend, 'archive/lmu/s1/r1/samples.parquet');
  await put(backend, 'archive/lmu/s1/r1/events.parquet');
  // Analysis asks as the cloud does: by the owner's name for the file.
  const cloud = adminBackend({db, bucket});
  let input;
  await assert.rejects(
    analyzeStored({
      backend: cloud,
      sessionId: 's1',
      owner: 'botkin',
      workDir: mkdtempSync(join(tmpdir(), 'adminArchive-')),
      analyze: i => {
        input = i;
        throw new Error('stop after the download');
      },
    }),
    /stop after the download/,
  );
  assert.equal(readFileSync(input.recordings[0].samplesPath, 'utf8'), 'S');
});
