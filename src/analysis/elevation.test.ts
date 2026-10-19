import {describe, expect, it} from '@jest/globals';

import {heightAt, heightOnLap, heightRange, heightsOnGrid} from './elevation';

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

describe('heightOnLap', () => {
  // Points every 10 m on a 45 m lap: the last point is at 40 m, and 40..45 m runs back to the first.
  const lap = {stepM: 10, heightM: [0, 10, 20, 30, 40]};
  it('reads like heightAt inside the profile', () => {
    expect(heightOnLap(lap, 15, 45)).toBeCloseTo(15);
    expect(heightOnLap(lap, 40, 45)).toBeCloseTo(40);
  });
  it('wraps: past the last point the height runs back to the first, and laps repeat', () => {
    expect(heightOnLap(lap, 42.5, 45)).toBeCloseTo(20);
    expect(heightOnLap(lap, 45 + 15, 45)).toBeCloseTo(15);
    expect(heightOnLap(lap, -2.5, 45)).toBeCloseTo(20);
  });
});

