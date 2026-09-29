import {describe, expect, it} from '@jest/globals';

import {updateAt} from './field';

describe('updateAt', () => {
  const t = Float64Array.of(0, 0.2, 0.4, 0.6);
  it('finds the nearest update and clamps to the ends', () => {
    expect(updateAt(t, 0.29)).toBe(1);
    expect(updateAt(t, 0.31)).toBe(2);
    expect(updateAt(t, -5)).toBe(0);
    expect(updateAt(t, 99)).toBe(3);
  });
  it('answers -1 for an empty field', () => {
    expect(updateAt(new Float64Array(0), 1)).toBe(-1);
  });
});
