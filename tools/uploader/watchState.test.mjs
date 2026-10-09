// Run: node --test tools/uploader/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clearStaleSyncing, stateOf} from './watchState.mjs';

const lmu = {id: 'lmu', adapter: {watcher: {legacyLayout: true}}};
const iracing = {id: 'iracing', adapter: {watcher: {legacyLayout: false}}};

test('a watcher that died mid-sync: every sim starts with syncing cleared', () => {
  const watch = {
    syncing: true,
    retries: {},
    sims: {iracing: {retries: {}, syncing: true}},
  };
  clearStaleSyncing(watch, [lmu, iracing]);
  assert.equal(watch.syncing, false, 'the legacy sim is the top level');
  assert.equal(watch.sims.iracing.syncing, false);
});

test('a sim with no state yet gets a fresh one, not syncing', () => {
  const watch = {};
  clearStaleSyncing(watch, [lmu, iracing]);
  assert.equal(watch.syncing, false);
  assert.deepEqual(watch.sims.iracing, {retries: {}, syncing: false});
});

test("the legacy sim's state is the watch object itself, not under sims", () => {
  const watch = {lastRunAtMs: 5};
  assert.equal(stateOf(watch, lmu), watch);
  assert.equal(watch.sims, undefined);
});
