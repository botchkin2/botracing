import {describe, expect, it} from '@jest/globals';

import {undelta, updateAt} from './field';

describe('undelta', () => {
  it('sums deltas and keeps gaps as null without breaking the sum', () => {
    expect(undelta([1000, 105, null, 105])).toEqual([1000, 1105, null, 1210]);
    expect(undelta([])).toEqual([]);
  });
});

describe('updateAt', () => {
  const t = [0, 0.2, 0.4, 0.6];
  it('finds the nearest update and clamps to the ends', () => {
    expect(updateAt(t, 0.29)).toBe(1);
    expect(updateAt(t, 0.31)).toBe(2);
    expect(updateAt(t, -5)).toBe(0);
    expect(updateAt(t, 99)).toBe(3);
  });
  it('answers -1 for an empty field', () => {
    expect(updateAt([], 1)).toBe(-1);
  });
});
