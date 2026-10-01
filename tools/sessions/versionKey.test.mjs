// Run: node --test tools/sessions/versionKey.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analysisVersion, blockVersions} from './analyze.mjs';
import {versionKey} from './versionKey.mjs';

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
