import assert from 'node:assert/strict';
import {test} from 'node:test';

import {holderMessage, holdersOf, listenersOn} from './portHolder.mjs';

const NETSTAT = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    127.0.0.1:19103        0.0.0.0:0              LISTENING       32172
  TCP    [::1]:19103            [::]:0                 LISTENING       4176
  TCP    127.0.0.1:19103        127.0.0.1:50618        ESTABLISHED     32172
  TCP    127.0.0.1:19104        0.0.0.0:0              LISTENING       999
  TCP    0.0.0.0:191030         0.0.0.0:0              LISTENING       5
`;

test('names the listeners on a port, any family, and nothing else', () => {
  assert.deepEqual(listenersOn(NETSTAT, 19103), [
    {address: '127.0.0.1', pid: 32172},
    {address: '::1', pid: 4176},
  ]);
  assert.deepEqual(listenersOn(NETSTAT, 19105), []);
});

test('holdersOf reads netstat on Windows and is empty elsewhere', () => {
  const run = () => ({status: 0, stdout: NETSTAT});
  assert.equal(holdersOf(19103, {platform: 'win32', run}).length, 2);
  assert.deepEqual(holdersOf(19103, {platform: 'linux', run}), []);
  assert.deepEqual(
    holdersOf(19103, {platform: 'win32', run: () => ({status: 1, stdout: ''})}),
    [],
  );
});

test('the refusal says whose pid holds it', () => {
  assert.equal(
    holderMessage(19103, [{address: '127.0.0.1', pid: 32172}]),
    'port 19103 is held by pid 32172 (127.0.0.1)',
  );
});
