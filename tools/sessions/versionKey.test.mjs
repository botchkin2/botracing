// Run: node --test tools/sessions/versionKey.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analysisVersion, blockVersions} from './analyze.mjs';
import {analysisStamp, isStale, versionKey} from './versionKey.mjs';

test('the key is the analysis version and every block, in a fixed order', () => {
  assert.equal(
    versionKey(17, {tyres: 1, traffic: 1, gridLap: 1}),
    '17|gridLap=1,traffic=1,tyres=1',
  );
  assert.equal(versionKey(17, {}), '17|');
});

test('the order the blocks were declared in does not matter', () => {
  assert.equal(
    versionKey(17, {tyres: 1, traffic: 2}),
    versionKey(17, {traffic: 2, tyres: 1}),
  );
});

test('a block bump alone changes the key: the case the watcher missed (#1530)', () => {
  const before = versionKey(17, {tyres: 1, traffic: 1});
  assert.notEqual(before, versionKey(17, {tyres: 2, traffic: 1}));
  assert.notEqual(before, versionKey(17, {tyres: 1, traffic: 1, gridLap: 1}));
  assert.notEqual(before, versionKey(18, {tyres: 1, traffic: 1}));
  assert.equal(before, versionKey(17, {tyres: 1, traffic: 1}));
});

test('the real registry reaches the key: bumping any of its blocks changes it', () => {
  const key = versionKey(analysisVersion, blockVersions);
  for (const name of Object.keys(blockVersions)) {
    const bumped = {...blockVersions, [name]: blockVersions[name] + 1};
    assert.notEqual(versionKey(analysisVersion, bumped), key, name);
  }
});

test('state from before block versions has no key, so it reads as changed', () => {
  const stored = {analysisVersion: 17}; // what the watcher stored until now
  assert.notEqual(
    stored.versionKey,
    versionKey(analysisVersion, blockVersions),
  );
});

test('a stamp records the versions and the kept blocks, sorted and once each', () => {
  assert.deepEqual(
    analysisStamp(17, {tyres: 2}, ['pitVisit', 'raceLength', 'pitVisit']),
    {v: 17, blocks: {tyres: 2}, kept: ['pitVisit', 'raceLength']},
  );
});

test('no stamp, an older analysis or an older block is stale', () => {
  const code = {tyres: 2, pitVisit: 3};
  assert.equal(isStale(null, 17, code), true);
  assert.equal(isStale({}, 17, code), true);
  assert.equal(isStale(analysisStamp(16, code), 17, code), true);
  assert.equal(isStale(analysisStamp(17, {...code, tyres: 1}), 17, code), true);
  assert.equal(isStale(analysisStamp(17, {tyres: 2}), 17, code), true);
  assert.equal(isStale(analysisStamp(17, code), 17, code), false);
});

test('a kept block never makes the session stale, so an open does not re-run it forever', () => {
  const code = {tyres: 2, pitVisit: 4, raceLength: 2};
  const stamp = analysisStamp(17, {tyres: 2, pitVisit: 3, raceLength: 1}, [
    'pitVisit',
    'raceLength',
  ]);
  assert.equal(isStale(stamp, 17, code), false);
  // A block that was not kept still counts.
  assert.equal(isStale(stamp, 17, {...code, tyres: 3}), true);
});

test('the stamp of the real registry is fresh against itself', () => {
  assert.equal(
    isStale(
      analysisStamp(analysisVersion, blockVersions),
      analysisVersion,
      blockVersions,
    ),
    false,
  );
});
