import assert from 'node:assert/strict';
import {test} from 'node:test';

import {accountFlags} from '../src/accountFlags.ts';

test('only a literal true turns the note link on', () => {
  assert.deepEqual(accountFlags({canSendNote: true}), {canSendNote: true});
  for (const v of [false, 'true', 1, null, undefined, {}, []])
    assert.deepEqual(accountFlags({canSendNote: v}), {canSendNote: false});
});

test('a doc without the field, an empty doc and no doc are all off', () => {
  assert.deepEqual(accountFlags({ownerKey: 'abc'}), {canSendNote: false});
  assert.deepEqual(accountFlags({}), {canSendNote: false});
  assert.deepEqual(accountFlags(undefined), {canSendNote: false});
  assert.deepEqual(accountFlags(null), {canSendNote: false});
  assert.deepEqual(accountFlags('canSendNote'), {canSendNote: false});
});

test('nothing else of the doc leaks into the answer', () => {
  assert.deepEqual(
    Object.keys(accountFlags({canSendNote: true, ownerKey: 'k', usage: {}})),
    ['canSendNote'],
  );
});
