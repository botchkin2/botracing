import {describe, expect, it} from '@jest/globals';

import {keepClear} from './labelPlace';

const box = (x: number, y: number) => ({x, y, width: 20, height: 10});

describe('keepClear', () => {
  it('keeps labels that do not touch', () => {
    expect(keepClear([box(0, 0), box(30, 0), box(0, 20)])).toEqual([0, 1, 2]);
  });
  it('drops the later of two overlapping labels', () => {
    expect(keepClear([box(0, 0), box(10, 5), box(50, 0)])).toEqual([0, 2]);
  });
  it('only tests against labels it kept', () => {
    // 1 overlaps 0 and is dropped; 2 overlaps only 1, so it stays.
    expect(keepClear([box(0, 0), box(15, 0), box(33, 0)])).toEqual([0, 2]);
  });
});
