import {describe, expect, it} from '@jest/globals';

import {heightAt, heightRange, heightsOnGrid} from './elevation';

const e = {stepM: 10, heightM: [0, 10, 4, 4, 8]};

describe('elevation', () => {
  it('reads a height between samples by a straight line, and clamps at the ends', () => {
    expect(heightAt(e, 5)).toBe(5);
    expect(heightAt(e, 15)).toBe(7);
    expect(heightAt(e, 10)).toBe(10);
    expect(heightAt(e, -20)).toBe(0);
    expect(heightAt(e, 999)).toBe(8);
  });

  it('resamples onto a finer grid of the lap, one value per point', () => {
    expect(heightsOnGrid(e, 5, 40)).toEqual([0, 5, 10, 7, 4, 4, 4, 6, 8]);
  });

  it('gives the lowest and highest height over a stretch, its ends included', () => {
    expect(heightRange(e, 5, 25)).toEqual({lo: 4, hi: 10});
    // 12 to 18 m: 10 + (4-10)*0.2 = 8.8 at the start, 10 + (4-10)*0.8 = 5.2 at the end.
    expect(heightRange(e, 12, 18).lo).toBeCloseTo(5.2);
    expect(heightRange(e, 12, 18).hi).toBeCloseTo(8.8);
  });
});
