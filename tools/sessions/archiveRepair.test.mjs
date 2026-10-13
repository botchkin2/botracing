import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {ARCHIVE_REPAIR, repairArchives} from './archiveRepair.mjs';

// Two uploaded sessions: s1's file was rounded by the old types, s2's was not;
// s3 was never uploaded from this PC.
function setup({sameBytes = false} = {}) {
  const calls = [];
  const store = {
    getRecording: async id => (id === 'r1' ? {archive: {samples: 'archive/iracing/s1/r1/samples.parquet'}} : null),
    replaceArchiveFile: async dest => (calls.push(['put', dest]), !sameBytes),
    markStale: async id => void calls.push(['stale', id]),
  };
  const writeArchive = (path, _info, samples) => {
    writeFileSync(samples, path);
    return {rounded: path === 'a.ibt' ? ['tyres_wear_fl'] : []};
  };
  const sessions = [
    {id: 's1', files: [{id: 'r1', path: 'a.ibt', info: {}}]},
    {id: 's2', files: [{id: 'r2', path: 'b.ibt', info: {}}]},
    {id: 's3', files: [{id: 'r3', path: 'a.ibt', info: {}}]},
  ];
  const state = {sessions: {s1: {}, s2: {}}};
  return {calls, store, writeArchive, sessions, state};
}

test('only a rounded file goes up, at the path its recording names, and its session reads stale', async () => {
  const {calls, store, writeArchive, sessions, state} = setup();
  const dir = mkdtempSync(join(tmpdir(), 'repair-'));
  let saves = 0;
  const n = await repairArchives({sessions, state, store, writeArchive, dir, save: () => saves++, sim: 'iracing'});
  assert.equal(n, 1);
  assert.deepEqual(calls, [['put', 'archive/iracing/s1/r1/samples.parquet'], ['stale', 's1']]);
  assert.deepEqual(state.archiveRepair, {s1: ARCHIVE_REPAIR, s2: ARCHIVE_REPAIR});
  assert.equal(saves, 2);
  // Once only: a second run sends nothing.
  calls.length = 0;
  assert.equal(await repairArchives({sessions, state, store, writeArchive, dir, save: () => {}, sim: 'iracing'}), 0);
  assert.deepEqual(calls, []);
});

test('a rounded file whose stored bytes already match is not a repair', async () => {
  const {calls, store, writeArchive, sessions, state} = setup({sameBytes: true});
  const dir = mkdtempSync(join(tmpdir(), 'repair-'));
  const n = await repairArchives({sessions, state, store, writeArchive, dir, save: () => {}, sim: 'iracing'});
  assert.equal(n, 0);
  assert.deepEqual(calls, [['put', 'archive/iracing/s1/r1/samples.parquet']]);
});
