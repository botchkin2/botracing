import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {isAlive, parentGone} from './parentGuard.mjs';

test('an unset or invalid LAP_PARENT_PID never stops the watcher', () => {
  assert.equal(parentGone({}), false);
  assert.equal(parentGone({LAP_PARENT_PID: 'x'}), false);
  assert.equal(parentGone({LAP_PARENT_PID: '0'}), false);
});

test('this process is alive; one that has exited is gone', () => {
  assert.equal(isAlive(process.pid), true);
  assert.equal(parentGone({LAP_PARENT_PID: String(process.pid)}), false);
  const done = spawnSync(process.execPath, ['-e', '']);
  assert.equal(parentGone({LAP_PARENT_PID: String(done.pid)}), true);
});

test('a process we may not signal still counts as alive', () => {
  const eperm = () => {
    throw Object.assign(new Error('no'), {code: 'EPERM'});
  };
  assert.equal(isAlive(4, eperm), true);
});
