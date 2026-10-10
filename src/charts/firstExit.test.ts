import {describe, expect, test} from '@jest/globals';

import {firstExit} from './firstExit';

describe('firstExit', () => {
  test('finds the first point above the scale and names the top edge', () => {
    expect(firstExit([0, 5, 12, 40, 9], 0, 4, 0, 10)).toEqual({
      index: 2,
      edge: 'top',
    });
  });

  test('finds a point below the scale and names the bottom edge', () => {
    expect(firstExit([5, -3, 1], 0, 2, 0, 10)).toEqual({
      index: 1,
      edge: 'bottom',
    });
  });

  test('a series that stays inside has no exit', () => {
    expect(firstExit([0, 5, 10], 0, 2, 0, 10)).toBeNull();
  });

  test('only the window counts: an exit past the window is not seen', () => {
    expect(firstExit([1, 2, 99], 0, 1, 0, 10)).toBeNull();
  });

  test('a window that starts after the exit does not see it either', () => {
    expect(firstExit([99, 1, 1], 1, 2, 0, 10)).toBeNull();
  });

  test('missing values are skipped, not taken for exits', () => {
    expect(firstExit([NaN, 4, Infinity, 20], 0, 3, 0, 10)).toEqual({
      index: 3,
      edge: 'top',
    });
  });

  test('a window beyond the series is clamped to its length', () => {
    expect(firstExit([1, 2], 0, 99, 0, 10)).toBeNull();
    expect(firstExit([1, 20], 0, 99, 0, 10)).toEqual({index: 1, edge: 'top'});
  });

  test('a value exactly on the edge is inside', () => {
    expect(firstExit([0, 10], 0, 1, 0, 10)).toBeNull();
  });
});
