import {describe, expect, it} from '@jest/globals';

import {toAccountFlags} from './adapters';

describe('toAccountFlags', () => {
  it('is on only for a literal true', () => {
    expect(toAccountFlags({canSendNote: true})).toEqual({canSendNote: true});
    for (const v of [false, 'true', 1, null, undefined, {}])
      expect(toAccountFlags({canSendNote: v})).toEqual({canSendNote: false});
  });

  it('reads a body that is not an object as off', () => {
    for (const body of [null, undefined, 'x', 7, []])
      expect(toAccountFlags(body)).toEqual({canSendNote: false});
  });
});
