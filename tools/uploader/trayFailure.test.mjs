// Run: node --test tools/uploader/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bodyOf, lastLine, messageOf} from './trayFailure.mjs';

const nowMs = Date.parse('2026-10-10T02:00:00Z');

test('the last line of the log is the cause; start markers do not count', () => {
  assert.equal(
    lastLine('--- uploader start (unix 1) ---\nError: boom\n  at x\n\n'),
    'at x',
  );
  assert.equal(lastLine('--- uploader start (unix 1) ---\n'), '');
  assert.equal(lastLine(undefined), '');
});

test('the message says why, then the last line, scrubbed, redacted and cut to 120', () => {
  assert.equal(
    messageOf({reason: 'exit code: 1', logText: 'Error: no file\n'}),
    'exit code: 1: Error: no file',
  );
  assert.equal(
    messageOf({reason: 'exit code: 1', logText: ''}),
    'exit code: 1',
  );
  const secret = messageOf({
    reason: 'exit code: 1',
    logText:
      "Error: ENOENT C:\\Users\\Jane Doe\\x for a@b.example eyJhbGciOi.eyJzdWIiOiIx.sig'",
  });
  assert.ok(!secret.includes('Jane'), secret);
  assert.ok(!secret.includes('a@b.example'), secret);
  assert.ok(!secret.includes('eyJ'), secret);
  assert.equal(messageOf({reason: 'r', logText: 'x'.repeat(500)}).length, 120);
});

test('the body has what the server requires, one uploader-stopped problem, and the tray version', () => {
  const body = bodyOf({
    hostId: 'ab12cd34',
    label: 'Race PC',
    version: '0.1.3',
    reason: 'exit code: 1',
    logText: 'Error: boom',
    count: 3,
    nowMs,
  });
  assert.deepEqual(body, {
    hostId: 'ab12cd34',
    label: 'Race PC',
    version: '0.1.3',
    lmuFound: false,
    state: 'error',
    problems: [
      {
        kind: 'uploader-stopped',
        at: '2026-10-10T02:00:00.000Z',
        message: 'exit code: 1: Error: boom',
        count: 3,
      },
    ],
  });
  const none = bodyOf({
    hostId: 'ab12cd34',
    label: 'L',
    version: 'v',
    reason: 'r',
    logText: '',
    count: NaN,
    nowMs,
  });
  assert.equal('count' in none.problems[0], false);
});
