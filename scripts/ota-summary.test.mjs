import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summary} from './ota-summary.mjs';

test('summary names group, runtime version and message', () => {
  const out = summary(
    [
      {
        platform: 'android',
        group: 'g-1',
        runtimeVersion: 'abc123',
        message: 'deadbeef',
        branch: 'production',
      },
    ],
    'deadbeef',
  );
  assert.match(out, /\| Group \| g-1 \|/);
  assert.match(out, /\| Runtime version \| abc123 \|/);
  assert.match(out, /\| Message \| deadbeef \|/);
});

test('summary fails loudly on output without a group', () => {
  assert.throws(() => summary([{platform: 'android'}], 'x'));
});
