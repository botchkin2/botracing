import {describe, expect, it} from '@jest/globals';

import {anchorLapOf, bestLapOf, firstLapOf, lapSlots} from './lapSlots';

const lap = (id: string, lapIndex: number, timeS: number | null) => ({
  id,
  lapIndex,
  timeS,
});

describe('lapSlots', () => {
  const laps = [lap('c', 9, 81), lap('a', 2, 80.5), lap('b', 5, 79.9)];

  it('gives the Ref lap slot 0 and the others lap-number order from 1', () => {
    expect(lapSlots(laps, 'b').get('b')).toBe(0);
    expect(lapSlots(laps, 'b').get('a')).toBe(1);
    expect(lapSlots(laps, 'b').get('c')).toBe(2);
  });

  it('without a Ref nobody is slot 0, and the list order does not matter', () => {
    const a = lapSlots(laps, null);
    const b = lapSlots([...laps].reverse(), undefined);
    expect([...a.values()].sort()).toEqual([1, 2, 3]);
    expect(a.get('a')).toBe(1);
    expect(a.get('b')).toBe(2);
    expect(a.get('c')).toBe(3);
    expect(Object.fromEntries(b)).toEqual(Object.fromEntries(a));
  });

  it('a Ref that is not in the set changes nothing', () => {
    expect(lapSlots(laps, 'zzz').get('a')).toBe(1);
  });
});

describe('the lap a screen reads from', () => {
  const laps = [lap('c', 9, 81), lap('a', 2, 80.5), lap('b', 5, 79.9)];

  it('best is the fastest timed lap, wherever it sits', () => {
    expect(bestLapOf(laps)?.id).toBe('b');
    expect(bestLapOf([lap('x', 1, null)])).toBeNull();
    expect(bestLapOf([])).toBeNull();
  });

  it('the anchor is the Ref when picked, else the best, else the lowest number', () => {
    expect(anchorLapOf(laps, 'c')?.id).toBe('c');
    expect(anchorLapOf(laps, null)?.id).toBe('b');
    expect(anchorLapOf(laps, 'gone')?.id).toBe('b');
    expect(anchorLapOf([lap('p', 7, null), lap('q', 3, null)], null)?.id).toBe('q');
    expect(anchorLapOf([], null)).toBeNull();
  });

  it('the first lap is the lowest number, not the first in the list', () => {
    expect(firstLapOf(laps)?.id).toBe('a');
    expect(firstLapOf([])).toBeNull();
  });
});
