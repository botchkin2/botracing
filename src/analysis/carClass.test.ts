import {describe, expect, it} from '@jest/globals';

import {classKey} from './carClass';

describe('classKey', () => {
  it('maps the sim strings, else other', () => {
    expect(
      ['Hyper', 'LMP2', 'GT3', 'LMGT3', 'GTE', '', 'Odd'].map(classKey),
    ).toEqual(['hypercar', 'lmp2', 'gt3', 'other', 'gt3', 'other', 'other']);
  });
  it('ignores case', () => {
    expect(['HYPERCAR', 'lmp2', 'Gt3'].map(classKey)).toEqual([
      'hypercar',
      'lmp2',
      'gt3',
    ]);
  });
});
